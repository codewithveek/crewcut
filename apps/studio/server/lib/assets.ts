import type { ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { type SQL, and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { parseJsonLoose } from "./json.js";
import { accessContext, identity } from "./identity.js";
import { containsText } from "./search.js";
import { referencedAssetIds } from "./render-runner.js";
import { removeFile, resolveFileUrls } from "./blob-store.js";
import { latestComposition, listVideos } from "./store.js";

export type AssetRow = typeof schema.assets.$inferSelect;
export type MediaType = "image" | "video" | "audio";

export function mediaTypeOf(mime: string): MediaType {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "audio";
}

export interface AssetDto {
  id: string;
  videoId: string | null;
  kind: string;
  mediaType: MediaType;
  label: string;
  mime: string;
  bytes: number;
  durationMs: number | null;
  url: string;
  source: string;
  createdAt: string;
}

/** DTOs for many rows; file URLs (remote or signed local) resolve in one query. */
export async function toAssetDtos(rows: readonly AssetRow[]): Promise<AssetDto[]> {
  const urls = await resolveFileUrls("assets", rows.map((row) => row.fileName));
  return rows.map((row) => toAssetDto(row, urls.get(row.fileName) ?? ""));
}

export function toAssetDto(row: AssetRow, url: string): AssetDto {
  const provenance = parseJsonLoose<{ provider?: string }>(row.provenance, {});
  return {
    id: row.id,
    videoId: row.videoId,
    kind: row.kind,
    mediaType: mediaTypeOf(row.mime),
    label: row.label,
    mime: row.mime,
    bytes: row.bytes,
    durationMs: row.durationMs,
    url,
    source: provenance.provider ?? "upload",
    createdAt: row.createdAt,
  };
}

export type AssetScope = "video" | "video_and_library" | "library" | "all";
export type AssetMediaFilter = MediaType | "visual";

export interface AssetSearch {
  scope: AssetScope;
  /** The video for scopes "video" / "video_and_library"; with "all", its own media is listed first. */
  videoId?: string;
  query?: string;
  mediaType?: AssetMediaFilter;
  limit: number;
  offset: number;
}

const mimeIs = (prefix: string) => sql`${schema.assets.mime} like ${`${prefix}/%`}`;
const MEDIA_WHERE: Record<AssetMediaFilter, SQL> = {
  image: mimeIs("image"),
  video: mimeIs("video"),
  audio: sql`not (${mimeIs("image")} or ${mimeIs("video")})`,
  visual: sql`(${mimeIs("image")} or ${mimeIs("video")})`,
};

/** Rows a person can see for a scope, as one SQL condition (no row cap, no second query). */
function scopeWhere(ctx: ActionRunContext | undefined, scope: AssetScope, videoId: string | undefined): SQL | undefined {
  const who = identity(ctx);
  const library = and(isNull(schema.assets.videoId), eq(schema.assets.ownerEmail, who.email));
  if (scope === "library") return library;
  if (scope === "video") return videoId ? eq(schema.assets.videoId, videoId) : sql`false`;
  if (scope === "video_and_library") return videoId ? or(library, eq(schema.assets.videoId, videoId)) : library;
  const visibleVideos = getDb().select({ id: schema.videos.id }).from(schema.videos).where(accessFilter(schema.videos, schema.videoShares, accessContext(who)));
  return or(library, inArray(schema.assets.videoId, visibleVideos));
}

/** One page of assets, newest first, with the total and per-type counts for the same scope and search. */
export async function searchAssets(ctx: ActionRunContext | undefined, options: AssetSearch): Promise<{ rows: AssetRow[]; total: number; counts: Record<MediaType, number> }> {
  const db = getDb();
  const base = and(scopeWhere(ctx, options.scope, options.videoId), options.query?.trim() ? containsText(schema.assets.label, options.query) : undefined);
  const where = and(base, options.mediaType ? MEDIA_WHERE[options.mediaType] : undefined);
  const count = (condition: SQL) => sql<number>`coalesce(sum(case when ${condition} then 1 else 0 end), 0)`;
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(schema.assets)
      .where(where)
      .orderBy(...(options.videoId ? [sql`case when ${schema.assets.videoId} = ${options.videoId} then 0 else 1 end`] : []), desc(schema.assets.createdAt), desc(schema.assets.id)).limit(options.limit).offset(options.offset),
    db.select({ image: count(MEDIA_WHERE.image), video: count(MEDIA_WHERE.video), audio: count(MEDIA_WHERE.audio) }).from(schema.assets).where(base),
  ]);
  const counts = { image: Number(totals?.image ?? 0), video: Number(totals?.video ?? 0), audio: Number(totals?.audio ?? 0) };
  const total = !options.mediaType ? counts.image + counts.video + counts.audio : options.mediaType === "visual" ? counts.image + counts.video : counts[options.mediaType];
  return { rows, total, counts };
}

/** One asset, if the person can see it (their library or a video they can see). */
export async function findVisibleAsset(ctx: ActionRunContext | undefined, assetId: string): Promise<AssetRow | null> {
  const [row] = await getDb().select().from(schema.assets).where(and(eq(schema.assets.id, assetId), scopeWhere(ctx, "all", undefined))).limit(1);
  return row ?? null;
}

/** Which of the person's videos currently use an asset (latest composition only). */
export async function videosUsingAsset(ctx: ActionRunContext | undefined, assetId: string): Promise<Array<{ id: string; title: string }>> {
  const videos = await listVideos(ctx);
  const users: Array<{ id: string; title: string }> = [];
  for (const video of videos) {
    const latest = await latestComposition(video.id);
    if (latest && referencedAssetIds(latest.composition).includes(assetId)) users.push({ id: video.id, title: video.title });
  }
  return users;
}

/**
 * Of these assets, the ones another video's edit history references (any
 * version, so restoring an old version can't break). Media can be used across
 * projects, so deleting a project must not take shared files with it.
 */
export async function assetsUsedElsewhere(assetIds: readonly string[], videoId: string): Promise<Set<string>> {
  const db = getDb();
  const used = new Set<string>();
  for (const assetId of assetIds) {
    const [hit] = await db
      .select({ id: schema.compositions.id })
      .from(schema.compositions)
      .where(and(sql`${schema.compositions.videoId} <> ${videoId}`, sql`${schema.compositions.body} like ${`%asset:${assetId}%`}`))
      .limit(1);
    if (hit) used.add(assetId);
  }
  return used;
}

export async function deleteAssetFile(row: AssetRow): Promise<void> {
  // Built-in library files are shared between asset rows; only uploads are removed.
  if (row.fileName.startsWith("lib-")) return;
  await removeFile("assets", row.fileName);
}
