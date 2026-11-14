import { type PastVideo, type ThumbnailTraits, scoreThumbnail, scoreTitle, titleChecks } from "@crewcut/analytics";
import { headlineWords, thumbnailChecks, thumbnailVariantSchema } from "@crewcut/composition";
import { metricsSchema, publishCopySchema } from "@crewcut/contracts";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import { nowIso, parseJson, toJson } from "./json.js";

/**
 * The thumbnail & title lab's data per video: the options, the chosen ones,
 * the last rendered thumbnail, and what was published (so the next videos are
 * scored against what this one did).
 */

export const MAX_TITLES = 12;
export const MAX_THUMBNAILS = 8;

const authorSchema = z.enum(["crew", "person"]);

export const titleOptionSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(100),
  /** The angle in a few words ("curiosity gap", "number + outcome"). */
  why: z.string().max(300).default(""),
  author: authorSchema.default("crew"),
  createdAt: z.string().default(() => nowIso()),
});
export type TitleOption = z.infer<typeof titleOptionSchema>;

export const thumbnailOptionSchema = thumbnailVariantSchema.extend({ author: authorSchema.default("crew"), createdAt: z.string().default(() => nowIso()) });
export type ThumbnailOption = z.infer<typeof thumbnailOptionSchema>;

const thumbnailTraitsSchema = z.object({ style: z.string(), position: z.string(), words: z.number(), logo: z.boolean() });

export const packagingSchema = z.object({
  titles: z.array(titleOptionSchema).max(MAX_TITLES).default([]),
  thumbnails: z.array(thumbnailOptionSchema).max(MAX_THUMBNAILS).default([]),
  chosenTitleId: z.string().optional(),
  chosenThumbnailId: z.string().optional(),
  /** The last rendered thumbnail picture and what it was rendered from. */
  rendered: z.object({ key: z.string(), fileName: z.string() }).optional(),
  published: z.object({ title: z.string(), thumbnail: thumbnailTraitsSchema.nullable(), at: z.string() }).optional(),
});
export type Packaging = z.infer<typeof packagingSchema>;

/** A new empty value each time: callers change what they read, so it must never be shared. */
const empty = (): Packaging => packagingSchema.parse({});

export async function readPackaging(videoId: string): Promise<Packaging> {
  const [row] = await getDb().select().from(schema.videoPackaging).where(eq(schema.videoPackaging.videoId, videoId)).limit(1);
  return parseJson(packagingSchema, row?.body, empty());
}

export async function savePackaging(video: { id: string; ownerEmail: string; orgId: string | null }, packaging: Packaging): Promise<void> {
  const body = toJson(packagingSchema.parse(packaging));
  await getDb()
    .insert(schema.videoPackaging)
    .values({ videoId: video.id, body, updatedAt: nowIso(), ownerEmail: video.ownerEmail, orgId: video.orgId })
    .onConflictDoUpdate({ target: schema.videoPackaging.videoId, set: { body, updatedAt: nowIso() } });
}

export function traitsOf(option: Pick<ThumbnailOption, "style" | "position" | "headline" | "logo">): ThumbnailTraits {
  return { style: option.style, position: option.position, words: headlineWords(option.headline), logo: option.logo };
}

const WINDOW_ORDER = ["28d", "7d", "48h"];

/**
 * The owner's published videos with their latest YouTube click-through
 * numbers (28-day window first), newest first, without `exceptVideoId`.
 */
export async function packagingHistory(ownerEmail: string, exceptVideoId?: string): Promise<PastVideo[]> {
  const db = getDb();
  const P = schema.publishJobs;
  const posts = await db
    .select({ videoId: P.videoId, copy: P.copy })
    .from(P)
    .where(and(eq(P.ownerEmail, ownerEmail), eq(P.status, "published"), ...(exceptVideoId ? [ne(P.videoId, exceptVideoId)] : [])))
    .orderBy(desc(P.createdAt))
    .limit(300);
  const latestPost = new Map<string, string>();
  for (const post of posts) {
    if (latestPost.has(post.videoId)) continue;
    const copy = parseJson(publishCopySchema, post.copy, null as never);
    if (copy?.title) latestPost.set(post.videoId, copy.title);
  }
  const ids = [...latestPost.keys()];
  if (ids.length === 0) return [];
  const M = schema.metricSnapshots;
  const [snapshots, packaging] = await Promise.all([
    db
      .select({ videoId: M.videoId, window: M.window, metrics: M.metrics, capturedAt: M.capturedAt })
      .from(M)
      .where(and(inArray(M.videoId, ids), eq(M.source, "youtube")))
      .orderBy(desc(M.capturedAt)),
    db.select({ videoId: schema.videoPackaging.videoId, body: schema.videoPackaging.body }).from(schema.videoPackaging).where(inArray(schema.videoPackaging.videoId, ids)),
  ]);
  const published = new Map(packaging.map((row) => [row.videoId, parseJson(packagingSchema, row.body, empty()).published ?? null]));
  const history: PastVideo[] = [];
  for (const videoId of ids) {
    const mine = snapshots.filter((snapshot) => snapshot.videoId === videoId);
    const best = WINDOW_ORDER.map((window) => mine.find((snapshot) => snapshot.window === window)).find(Boolean);
    if (!best) continue;
    const metrics = parseJson(metricsSchema, best.metrics, null as never);
    if (!metrics) continue;
    const record = published.get(videoId);
    history.push({ title: record?.title ?? latestPost.get(videoId)!, ctr: metrics.ctr, impressions: metrics.impressions, thumbnail: record?.thumbnail ?? null });
  }
  return history;
}

/** The options with their scores and checks, best first within each list, plus what the scores rest on. */
export function scorePackaging(packaging: Packaging, history: readonly PastVideo[]) {
  const titles = packaging.titles.map((option) => ({ ...option, chosen: option.id === packaging.chosenTitleId, score: scoreTitle(option.text, history), checks: titleChecks(option.text) }));
  const thumbnails = packaging.thumbnails.map((option) => ({ ...option, chosen: option.id === packaging.chosenThumbnailId, score: scoreThumbnail(traitsOf(option), history), checks: thumbnailChecks(option) }));
  const rank = (a: { score: { predictedCtr: number | null } }, b: { score: { predictedCtr: number | null } }) => (b.score.predictedCtr ?? -1) - (a.score.predictedCtr ?? -1);
  const measuredCount = history.filter((video) => video.impressions >= 100 && video.ctr > 0).length;
  return {
    titles: [...titles].sort(rank),
    thumbnails: [...thumbnails].sort(rank),
    chosenTitleId: packaging.chosenTitleId ?? null,
    chosenThumbnailId: packaging.chosenThumbnailId ?? null,
    history: { published: history.length, measured: measuredCount },
    published: packaging.published ?? null,
  };
}
