import { type StockOrientation, type StockPhoto, StockError, createStockClient } from "@crewcut/stock";
import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { importStockPhoto, stockEnabled } from "./templates.js";

/**
 * Stock photo search for the editor and the agent (Pexels). Pexels allows
 * 200 requests an hour per key, so results are cached in memory for a while
 * and every photo seen in a search is remembered: importing it later needs no
 * extra request. The client only ever sends a photo id; the download address
 * comes from Pexels, never from the browser.
 */

export interface StockSearchResult {
  photos: StockPhoto[];
  total: number;
  page: number;
  perPage: number;
}

const SEARCH_TTL_MS = 30 * 60 * 1000;
const MAX_SEARCHES = 300;
const MAX_PHOTOS = 3000;
const searches = new Map<string, { at: number; value: StockSearchResult }>();
const pendingSearches = new Map<string, Promise<StockSearchResult>>();
const seenPhotos = new Map<number, StockPhoto>();

function client() {
  return createStockClient({ apiKey: process.env.PEXELS_API_KEY ?? "" });
}

function remember(photos: readonly StockPhoto[]): void {
  for (const photo of photos) {
    seenPhotos.delete(photo.id);
    seenPhotos.set(photo.id, photo);
  }
  while (seenPhotos.size > MAX_PHOTOS) {
    const oldest = seenPhotos.keys().next().value;
    if (oldest === undefined) break;
    seenPhotos.delete(oldest);
  }
}

/** A page of stock photos for a search, or Pexels' curated photos when the search is empty. Throws StockError on API problems. */
export async function searchStockPhotos(options: { query?: string; orientation?: StockOrientation; page?: number; perPage?: number }): Promise<StockSearchResult> {
  if (!stockEnabled()) throw new StockError("Stock photos aren't set up on this server.");
  const query = (options.query ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const page = Math.min(Math.max(Math.trunc(options.page ?? 1), 1), 100);
  const perPage = Math.min(Math.max(Math.trunc(options.perPage ?? 30), 1), 80);
  const orientation = query ? options.orientation : undefined;
  const key = `${query}|${orientation ?? ""}|${page}|${perPage}`;
  const cached = searches.get(key);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.value;
  let job = pendingSearches.get(key);
  if (!job) {
    job = (async () => {
      const result = query ? await client().searchPhotos(query, { ...(orientation ? { orientation } : {}), page, perPage }) : await client().curatedPhotos({ page, perPage });
      const value: StockSearchResult = { photos: result.photos, total: result.total, page, perPage };
      remember(result.photos);
      searches.delete(key);
      searches.set(key, { at: Date.now(), value });
      while (searches.size > MAX_SEARCHES) {
        const oldest = searches.keys().next().value;
        if (oldest === undefined) break;
        searches.delete(oldest);
      }
      return value;
    })().finally(() => pendingSearches.delete(key));
    pendingSearches.set(key, job);
  }
  return job;
}

/** A stock photo by its Pexels id: from recent searches, else asked from Pexels. */
export async function stockPhotoById(id: number): Promise<StockPhoto> {
  if (!stockEnabled()) throw new StockError("Stock photos aren't set up on this server.");
  const known = seenPhotos.get(id);
  if (known) return known;
  const photo = await client().getPhoto(id);
  remember([photo]);
  return photo;
}

/**
 * The asset for a stock photo in a video (or the person's library when there's
 * no video), downloading it only the first time: adding the same photo twice
 * reuses one file.
 */
export async function importStockPhotoOnce(photo: StockPhoto, owner: { videoId: string | null; ownerEmail: string; orgId: string | null }): Promise<{ assetId: string; reused: boolean }> {
  const scope = owner.videoId ? eq(schema.assets.videoId, owner.videoId) : and(isNull(schema.assets.videoId), eq(schema.assets.ownerEmail, owner.ownerEmail));
  // Provenance is stored as JSON text starting {"provider":"pexels","id":<id>,…}.
  const marker = `%"provider":"pexels","id":${Math.trunc(photo.id)},%`;
  const [existing] = await getDb()
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(and(scope, sql`${schema.assets.provenance} like ${marker}`))
    .limit(1);
  if (existing) return { assetId: existing.id, reused: true };
  const ref = await importStockPhoto(photo, owner);
  return { assetId: ref.replace(/^asset:/, ""), reused: false };
}

/** A message people can act on, for errors from Pexels. */
export function stockErrorMessage(error: unknown): string {
  if (error instanceof StockError) {
    if (error.status === 429) return "Too many stock searches in the last hour. Try again in a little while.";
    if (error.status === 401 || error.status === 403) return "Stock photos aren't available right now (the server's Pexels key was refused).";
    if (error.status === 404) return "That stock photo no longer exists on Pexels.";
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
