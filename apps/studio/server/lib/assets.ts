import type { ActionRunContext } from "@agent-native/core/action";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { parseJsonLoose } from "./json.js";
import { identity } from "./identity.js";
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

/** Assets a person can use: their library (no video) plus assets of videos they can see. */
export async function listVisibleAssets(ctx: ActionRunContext | undefined, options: { videoId?: string; scope: "video" | "library" | "all" }): Promise<AssetRow[]> {
  const who = identity(ctx);
  const db = getDb();
  if (options.scope === "video") {
    if (!options.videoId) return [];
    return db.select().from(schema.assets).where(eq(schema.assets.videoId, options.videoId)).orderBy(desc(schema.assets.createdAt)).limit(500);
  }
  const library = and(isNull(schema.assets.videoId), eq(schema.assets.ownerEmail, who.email));
  if (options.scope === "library") return db.select().from(schema.assets).where(library).orderBy(desc(schema.assets.createdAt)).limit(500);
  const videoIds = (await listVideos(ctx)).map((video) => video.id);
  const where = videoIds.length ? or(library, inArray(schema.assets.videoId, videoIds)) : library;
  return db.select().from(schema.assets).where(where).orderBy(desc(schema.assets.createdAt)).limit(500);
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

export async function deleteAssetFile(row: AssetRow): Promise<void> {
  // Built-in library files are shared between asset rows; only uploads are removed.
  if (row.fileName.startsWith("lib-")) return;
  await removeFile("assets", row.fileName);
}
