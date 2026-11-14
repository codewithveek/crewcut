import { type CandidateVideo, median } from "./trends";

/**
 * Outlier search on the official YouTube Data API: videos in a niche that got
 * far more views than their own channel usually gets. The caller supplies
 * `get` (an authenticated GET against https://www.googleapis.com/youtube/v3),
 * so this module never sees keys and can be tested with plain objects.
 *
 * Quota, per search: search.list 100 units, then 1 unit per videos.list,
 * channels.list and playlistItems.list page — about 120 units in all.
 */

export type YouTubeGet = (resource: "search" | "videos" | "channels" | "playlistItems", params: Record<string, string>) => Promise<unknown>;

export interface OutlierSearchOptions {
  query: string;
  /** Only videos published in this many days (default 90, 1–365). */
  publishedWithinDays?: number;
  /** Videos to check from the search (default 25, 5–50). */
  maxResults?: number;
  /** Views ÷ channel median needed to count (default 3). */
  minScore?: number;
  /** Shorts-length (3 minutes or less), longer videos, or both. */
  length?: "short" | "long" | "any";
  /** ISO 3166-1 alpha-2, e.g. "US". */
  regionCode?: string;
  /** ISO 639-1, e.g. "en". */
  language?: string;
  now?: number;
}

export interface YouTubeOutlier extends CandidateVideo {
  url: string;
  channelTitle: string;
  channelMedianViews: number;
  /** How many of the channel's recent uploads the median is taken from. */
  channelSample: number;
  subscribers: number | null;
  durationSec: number | null;
  /** views ÷ channel median, one decimal. */
  outlierScore: number;
}

export interface OutlierSearchResult {
  outliers: YouTubeOutlier[];
  /** Videos the search returned and that had public view counts. */
  checked: number;
  /** Channels a video was compared against. */
  channelsMeasured: number;
  /** Channels left out: too few public uploads (older than 3 days) to compare against. */
  channelsSkipped: number;
}

/** Recent uploads read per channel to find its usual views. */
const HISTORY_PER_CHANNEL = 30;
/** Fewer comparable uploads than this and the channel's "usual" isn't meaningful. */
const MIN_HISTORY = 5;
/** Uploads younger than this haven't collected their views yet, so they would drag the median down. */
const MIN_HISTORY_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_CHANNELS = 20;
/** YouTube Shorts can run up to 3 minutes. */
const SHORT_MAX_SEC = 180;

interface VideoFacts {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  views: number | null;
  durationSec: number | null;
}

/** "PT1H2M3S" → 3723. Unknown shapes → null. */
export function isoDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match || value === "P" || value === "PT") return null;
  const [, d = "0", h = "0", m = "0", s = "0"] = match;
  return Number(d) * 86_400 + Number(h) * 3_600 + Number(m) * 60 + Number(s);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function items(response: unknown): Record<string, unknown>[] {
  const list = record(response).items;
  return Array.isArray(list) ? list.map(record) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** YouTube sends counts as strings; hidden counts are missing. */
function count(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function videoFacts(get: YouTubeGet, ids: readonly string[]): Promise<Map<string, VideoFacts>> {
  const facts = new Map<string, VideoFacts>();
  for (const batch of chunks([...new Set(ids)], 50)) {
    const response = await get("videos", { part: "snippet,statistics,contentDetails", id: batch.join(","), maxResults: "50" });
    for (const item of items(response)) {
      const id = str(item.id);
      if (!id) continue;
      const snippet = record(item.snippet);
      facts.set(id, {
        id,
        title: str(snippet.title),
        channelId: str(snippet.channelId),
        channelTitle: str(snippet.channelTitle),
        publishedAt: str(snippet.publishedAt),
        views: count(record(item.statistics).viewCount),
        durationSec: isoDurationSeconds(record(item.contentDetails).duration),
      });
    }
  }
  return facts;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.min(max, Math.max(min, n));
}

function lengthMatches(length: OutlierSearchOptions["length"], durationSec: number | null): boolean {
  if (!length || length === "any" || durationSec === null) return true;
  return length === "short" ? durationSec <= SHORT_MAX_SEC : durationSec > SHORT_MAX_SEC;
}

export async function searchYouTubeOutliers(get: YouTubeGet, options: OutlierSearchOptions): Promise<OutlierSearchResult> {
  const query = options.query.trim().replace(/\s+/g, " ");
  if (!query) throw new Error("A search query is required.");
  const now = options.now ?? Date.now();
  const days = clampInt(options.publishedWithinDays, 90, 1, 365);
  const maxResults = clampInt(options.maxResults, 25, 5, 50);
  const minScore = Number.isFinite(options.minScore) ? Math.max(1, options.minScore as number) : 3;

  const searchParams: Record<string, string> = {
    part: "snippet",
    type: "video",
    q: query,
    order: "viewCount",
    maxResults: String(maxResults),
    publishedAfter: new Date(now - days * 24 * 60 * 60 * 1000).toISOString(),
  };
  // YouTube's "short" bucket is under 4 minutes, a superset of Shorts; its
  // "medium"/"long" buckets would drop 3–4 and 20+ minute videos, so longer
  // videos are filtered by their real duration below instead.
  if (options.length === "short") searchParams.videoDuration = "short";
  if (options.regionCode && /^[A-Za-z]{2}$/.test(options.regionCode)) searchParams.regionCode = options.regionCode.toUpperCase();
  if (options.language && /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/.test(options.language)) searchParams.relevanceLanguage = options.language;

  const found = items(await get("search", searchParams))
    .map((item) => str(record(item.id).videoId))
    .filter(Boolean);
  const candidates = [...(await videoFacts(get, found)).values()].filter(
    (video) => video.views !== null && video.channelId && lengthMatches(options.length, video.durationSec),
  );

  // Most-viewed first, so the channels measured are the ones most likely to matter.
  const channelIds = [...new Set([...candidates].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).map((video) => video.channelId))].slice(0, MAX_CHANNELS);
  const channels = new Map<string, { uploads: string; subscribers: number | null }>();
  for (const batch of chunks(channelIds, 50)) {
    const response = await get("channels", { part: "contentDetails,statistics", id: batch.join(","), maxResults: "50" });
    for (const item of items(response)) {
      const uploads = str(record(record(record(item.contentDetails).relatedPlaylists)).uploads);
      const statistics = record(item.statistics);
      const subscribers = statistics.hiddenSubscriberCount === true ? null : count(statistics.subscriberCount);
      if (str(item.id) && uploads) channels.set(str(item.id), { uploads, subscribers });
    }
  }

  const uploadsByChannel = new Map<string, string[]>();
  for (const [channelId, channel] of channels) {
    const response = await get("playlistItems", { part: "contentDetails", playlistId: channel.uploads, maxResults: String(HISTORY_PER_CHANNEL) });
    uploadsByChannel.set(
      channelId,
      items(response)
        .map((item) => str(record(item.contentDetails).videoId))
        .filter(Boolean),
    );
  }
  const history = await videoFacts(get, [...uploadsByChannel.values()].flat());

  // Per channel: recent uploads old enough to have collected their views, with public counts.
  const comparable = new Map<string, VideoFacts[]>();
  for (const [channelId, uploadIds] of uploadsByChannel) {
    comparable.set(
      channelId,
      uploadIds.flatMap((id) => {
        const video = history.get(id);
        if (!video || video.views === null) return [];
        const published = Date.parse(video.publishedAt);
        return Number.isFinite(published) && now - published >= MIN_HISTORY_AGE_MS ? [video] : [];
      }),
    );
  }
  // Channels at least one video was actually compared against.
  const measured = new Set<string>();

  const outliers: YouTubeOutlier[] = [];
  for (const video of candidates) {
    // The channel's usual views, without the video being judged.
    const others = (comparable.get(video.channelId) ?? []).filter((item) => item.id !== video.id).map((item) => item.views as number);
    if (others.length < MIN_HISTORY) continue;
    const usual = median(others);
    if (usual <= 0) continue;
    measured.add(video.channelId);
    const score = Math.round(((video.views as number) / usual) * 10) / 10;
    if (score < minScore) continue;
    outliers.push({
      id: video.id,
      title: video.title,
      channelId: video.channelId,
      channelTitle: video.channelTitle,
      views: video.views as number,
      publishedAt: video.publishedAt,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`,
      channelMedianViews: Math.round(usual),
      channelSample: others.length,
      subscribers: channels.get(video.channelId)?.subscribers ?? null,
      durationSec: video.durationSec,
      outlierScore: score,
    });
  }
  outliers.sort((a, b) => b.outlierScore - a.outlierScore || b.views - a.views);
  return { outliers, checked: candidates.length, channelsMeasured: measured.size, channelsSkipped: comparable.size - measured.size };
}
