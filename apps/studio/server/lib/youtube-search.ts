import { type OutlierSearchOptions, type OutlierSearchResult, type YouTubeGet, searchYouTubeOutliers } from "@crewcut/analytics";
import { YouTubeError, parseYouTubeError } from "@crewcut/distribute";

/**
 * Public YouTube search for the trend agent, on the deployment's own API key
 * (YOUTUBE_API_KEY). It never uses a person's connected channel: their
 * `youtube.readonly` grant is promised for their own channel only.
 *
 * Each search costs ~120 of the project's 10,000 daily quota units, so
 * results are cached for a few hours and each person gets a daily allowance
 * (CREWCUT_OUTLIER_SEARCHES_PER_DAY, default 15). Both live in memory: a
 * restart forgets them, which only ever errs towards allowing a search.
 */

const API = "https://www.googleapis.com/youtube/v3";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const cache = new Map<string, { at: number; value: OutlierSearchResult }>();
const pending = new Map<string, Promise<OutlierSearchResult>>();
const usage = new Map<string, number[]>();

export function outlierSearchEnabled(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

function dailyAllowance(): number {
  const n = Number(process.env.CREWCUT_OUTLIER_SEARCHES_PER_DAY);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 15;
}

export class OutlierSearchError extends Error {
  override readonly name = "OutlierSearchError";
}

function apiGet(key: string): YouTubeGet {
  return async (resource, params) => {
    const url = `${API}/${resource}?${new URLSearchParams({ ...params, key }).toString()}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new OutlierSearchError("YouTube didn't answer. Try again in a minute, or use web search for now.");
    }
    if (!response.ok) {
      const error = await parseYouTubeError(response);
      throw new OutlierSearchError(describe(error));
    }
    return response.json();
  };
}

function describe(error: YouTubeError): string {
  if (error.code === "quota") return "YouTube's daily search quota for Crewcut is used up. It resets at midnight Pacific time; use web search until then.";
  if (error.code === "rate_limited") return "YouTube is limiting searches right now. Try again in a minute.";
  // A bad key or the Data API not enabled: the person can't fix it, the operator can.
  if (error.status === 400 || error.status === 403) return "YouTube search isn't working on this server (its API key was refused). Use web search instead.";
  return "YouTube search failed. Try again later, or use web search instead.";
}

function cacheKey(options: OutlierSearchOptions): string {
  return JSON.stringify([
    options.query.trim().replace(/\s+/g, " ").toLowerCase(),
    options.publishedWithinDays ?? 90,
    options.maxResults ?? 25,
    options.minScore ?? 3,
    options.length ?? "any",
    options.regionCode?.toUpperCase() ?? "",
    options.language?.toLowerCase() ?? "",
  ]);
}

/** Searches left today for this person (the cache doesn't use any). */
export function outlierSearchesLeft(person: string, now = Date.now()): number {
  const recent = (usage.get(person) ?? []).filter((at) => now - at < DAY_MS);
  return Math.max(0, dailyAllowance() - recent.length);
}

function spend(person: string, now: number): void {
  const recent = (usage.get(person) ?? []).filter((at) => now - at < DAY_MS);
  recent.push(now);
  usage.set(person, recent);
  // Forget people with nothing in the window, so the map can't grow forever.
  if (usage.size > 5000) for (const [key, list] of usage) if (list.every((at) => now - at >= DAY_MS)) usage.delete(key);
}

export async function findYouTubeOutliers(person: string, options: OutlierSearchOptions): Promise<OutlierSearchResult & { cached: boolean }> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) throw new OutlierSearchError("YouTube search isn't set up on this server. Use web search instead.");
  const id = cacheKey(options);
  const now = Date.now();
  const hit = cache.get(id);
  if (hit && now - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };
  const running = pending.get(id);
  if (running) return { ...(await running), cached: true };
  if (outlierSearchesLeft(person, now) <= 0) {
    throw new OutlierSearchError(`You've used today's ${dailyAllowance()} YouTube outlier searches. Use web search for the rest of the evidence.`);
  }
  spend(person, now);
  const job = searchYouTubeOutliers(apiGet(key), options)
    .then((value) => {
      cache.delete(id);
      cache.set(id, { at: Date.now(), value });
      while (cache.size > MAX_CACHED) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return value;
    })
    .finally(() => pending.delete(id));
  pending.set(id, job);
  return { ...(await job), cached: false };
}
