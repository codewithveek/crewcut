import { type Metrics, PLATFORM_SPECS, type Privacy, type PublishCopy, metricsSchema } from "@crewcut/contracts";

import { adaptCopy } from "./copy";

/**
 * YouTube Data API v3 resumable upload (ported from vid-skills), fixed:
 * - a 308 without a Range header means nothing was stored → resume from 0
 * - quota errors (quotaExceeded, uploadLimitExceeded, rateLimitExceeded) are typed
 * - a 401 mid-upload refreshes the token once and resumes
 * - captions upload only after processing finishes, in the video's language
 * - forced-private (unaudited API project) is detected and reported, not hidden
 */
export interface VideoSource {
  size: number;
  mime: string;
  durationSec?: number;
  width?: number;
  height?: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export function bytesSource(bytes: Uint8Array, mime = "video/mp4", extra: Partial<VideoSource> = {}): VideoSource {
  return { size: bytes.byteLength, mime, read: async (offset, length) => bytes.subarray(offset, offset + length), ...extra };
}

export class YouTubeError extends Error {
  override readonly name = "YouTubeError";
  constructor(
    readonly code: "quota" | "rate_limited" | "auth" | "invalid" | "upload_failed" | "not_found",
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

interface GoogleErrorBody {
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string; message?: string }> };
}

export async function parseYouTubeError(response: Response): Promise<YouTubeError> {
  const text = await response.text();
  let reason = "";
  let message = text.slice(0, 400);
  try {
    const body = JSON.parse(text) as GoogleErrorBody;
    reason = body.error?.errors?.[0]?.reason ?? "";
    message = body.error?.message ?? message;
  } catch {
    // Non-JSON error body; keep the text.
  }
  if (reason === "quotaExceeded" || reason === "uploadLimitExceeded" || reason === "dailyLimitExceeded") {
    return new YouTubeError("quota", `YouTube quota reached (${reason}). Uploads resume when the daily quota resets.`, response.status, false);
  }
  if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded" || response.status === 429) {
    return new YouTubeError("rate_limited", `YouTube rate limit: ${message}`, response.status, true);
  }
  if (response.status === 401) return new YouTubeError("auth", "YouTube rejected the token.", 401, true);
  if (response.status === 404) return new YouTubeError("not_found", message, 404, false);
  if (response.status >= 500) return new YouTubeError("upload_failed", `YouTube ${response.status}: ${message}`, response.status, true);
  return new YouTubeError("invalid", `YouTube ${response.status}: ${message}`, response.status, false);
}

export interface YouTubeUploadInput {
  video: VideoSource;
  copy: PublishCopy;
  privacy: Privacy;
  /** Platform disclosure for synthetic media (always true for AI voice/visuals). */
  containsSyntheticMedia: boolean;
  shorts: boolean;
  categoryId?: string;
  captionsSrt?: string;
  thumbnail?: { bytes: Uint8Array; mime: string };
  publishAt?: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface YouTubeUploadResult {
  videoId: string;
  url: string;
  privacyStatus: string;
  warnings: string[];
}

export interface YouTubeClientOptions {
  /** Returns a valid token; `force` asks for a refreshed one after a 401. */
  getToken: (force?: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
  chunkBytes?: number;
  sleep?: (ms: number) => Promise<void>;
}

const CHUNK = 8 * 1024 * 1024; // multiple of 256 KiB
const MAX_STALLS = 5;

export function validateForYouTube(input: Pick<YouTubeUploadInput, "video" | "shorts" | "copy">): string[] {
  const spec = PLATFORM_SPECS[input.shorts ? "youtube_shorts" : "youtube"];
  const issues: string[] = [];
  if (input.video.durationSec !== undefined && input.video.durationSec > spec.maxSec) issues.push(`${spec.label}: ${input.video.durationSec}s exceeds ${spec.maxSec}s.`);
  if (input.shorts && input.video.width && input.video.height && input.video.width > input.video.height) issues.push("Shorts should be vertical or square.");
  if (input.video.size > spec.maxBytes) issues.push(`${spec.label}: file is larger than the platform allows.`);
  if (!input.copy.title.trim()) issues.push("A title is required.");
  return issues;
}

export class YouTubeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: YouTubeClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async authorized(url: string, init: RequestInit, retryOnAuth = true): Promise<Response> {
    const token = await this.options.getToken();
    const response = await this.fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } });
    if (response.status === 401 && retryOnAuth) {
      const fresh = await this.options.getToken(true);
      return this.fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${fresh}` } });
    }
    return response;
  }

  async upload(input: YouTubeUploadInput): Promise<YouTubeUploadResult> {
    const issues = validateForYouTube(input);
    if (issues.length > 0) throw new YouTubeError("invalid", issues.join(" "), 400, false);
    const platform = input.shorts ? "youtube_shorts" : "youtube";
    const text = adaptCopy(platform, input.copy);
    const metadata = {
      snippet: {
        title: text.title,
        description: text.text,
        tags: text.tags,
        categoryId: input.categoryId ?? "27",
        defaultLanguage: input.copy.language,
        defaultAudioLanguage: input.copy.language,
      },
      status: {
        privacyStatus: input.publishAt ? "private" : input.privacy,
        ...(input.publishAt ? { publishAt: input.publishAt } : {}),
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: input.containsSyntheticMedia,
      },
    };

    const init = await this.authorized("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(input.video.size),
        "x-upload-content-type": input.video.mime,
      },
      body: JSON.stringify(metadata),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!init.ok) throw await parseYouTubeError(init);
    const sessionUrl = init.headers.get("location");
    if (!sessionUrl) throw new YouTubeError("upload_failed", "YouTube returned no resumable session URL.", init.status, false);

    const video = await this.sendChunks(sessionUrl, input);
    const warnings: string[] = [];
    if (input.thumbnail) {
      const response = await this.authorized(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(video.id)}`, {
        method: "POST",
        headers: { "content-type": input.thumbnail.mime },
        body: input.thumbnail.bytes as BodyInit,
      });
      if (!response.ok) warnings.push("Thumbnail wasn't set (custom thumbnails need a verified channel).");
    }
    const status = await this.videoStatus(video.id).catch(() => null);
    const privacyStatus = status?.privacyStatus ?? metadata.status.privacyStatus;
    if (input.privacy !== "private" && privacyStatus === "private" && !input.publishAt) {
      warnings.push("YouTube kept the video private: the API project hasn't passed Google's compliance audit yet.");
    }
    if (input.captionsSrt) {
      warnings.push("Captions will upload once YouTube finishes processing the video.");
    }
    return {
      videoId: video.id,
      url: input.shorts ? `https://youtube.com/shorts/${video.id}` : `https://youtu.be/${video.id}`,
      privacyStatus,
      warnings,
    };
  }

  private async sendChunks(sessionUrl: string, input: YouTubeUploadInput): Promise<{ id: string }> {
    const chunkBytes = this.options.chunkBytes ?? CHUNK;
    const total = input.video.size;
    let offset = 0;
    let stalls = 0;
    for (;;) {
      const length = Math.min(chunkBytes, total - offset);
      const bytes = await input.video.read(offset, length);
      let response: Response;
      try {
        response = await this.authorized(sessionUrl, {
          method: "PUT",
          headers: { "content-length": String(length), "content-range": `bytes ${offset}-${offset + length - 1}/${total}` },
          body: bytes as BodyInit,
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch (error) {
        if (input.signal?.aborted || ++stalls > MAX_STALLS) throw error;
        await this.sleep(1000 * 2 ** stalls);
        offset = await this.resumeOffset(sessionUrl, total);
        continue;
      }
      if (response.status === 308) {
        offset = rangeEnd(response.headers.get("range"));
        stalls = 0;
        input.onProgress?.(offset / total);
        continue;
      }
      if (response.ok) {
        input.onProgress?.(1);
        const body = (await response.json()) as { id?: string };
        if (!body.id) throw new YouTubeError("upload_failed", "Upload finished without a video id.", response.status, false);
        return { id: body.id };
      }
      const error = await parseYouTubeError(response);
      if (!error.retryable || ++stalls > MAX_STALLS) throw error;
      await this.sleep(1000 * 2 ** stalls);
      offset = await this.resumeOffset(sessionUrl, total);
    }
  }

  private async resumeOffset(sessionUrl: string, total: number): Promise<number> {
    const response = await this.authorized(sessionUrl, { method: "PUT", headers: { "content-range": `bytes */${total}`, "content-length": "0" } });
    if (response.status === 308) return rangeEnd(response.headers.get("range"));
    if (response.ok) return total;
    throw await parseYouTubeError(response);
  }

  async videoStatus(videoId: string): Promise<{ privacyStatus: string; uploadStatus: string; processed: boolean } | null> {
    const response = await this.authorized(`https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`, { method: "GET" });
    if (!response.ok) throw await parseYouTubeError(response);
    const body = (await response.json()) as {
      items?: Array<{ status?: { privacyStatus?: string; uploadStatus?: string }; processingDetails?: { processingStatus?: string } }>;
    };
    const item = body.items?.[0];
    if (!item) return null;
    return {
      privacyStatus: item.status?.privacyStatus ?? "unknown",
      uploadStatus: item.status?.uploadStatus ?? "unknown",
      processed: item.processingDetails?.processingStatus === "succeeded" || item.status?.uploadStatus === "processed",
    };
  }

  /** Upload captions after processing (call from a follow-up job). */
  async uploadCaptions(videoId: string, srt: string, language: string): Promise<void> {
    const boundary = `crewcut${Date.now().toString(36)}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ snippet: { videoId, language, name: language.toUpperCase(), isDraft: false } })}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${srt}\r\n--${boundary}--`;
    const response = await this.authorized("https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart", {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!response.ok) throw await parseYouTubeError(response);
  }

  async channel(): Promise<{ id: string; title: string; handle?: string }> {
    const response = await this.authorized("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { method: "GET" });
    if (!response.ok) throw await parseYouTubeError(response);
    const body = (await response.json()) as { items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }> };
    const item = body.items?.[0];
    if (!item) throw new YouTubeError("not_found", "No YouTube channel on this Google account.", 404, false);
    return { id: item.id, title: item.snippet?.title ?? "YouTube channel", ...(item.snippet?.customUrl ? { handle: item.snippet.customUrl } : {}) };
  }

  /** Reads metrics for a video from the YouTube Analytics API (retention by elapsed ratio). */
  async metrics(videoId: string, options: { startDate: string; endDate: string }): Promise<Metrics> {
    const query = (params: Record<string, string>) =>
      `https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({ ids: "channel==MINE", startDate: options.startDate, endDate: options.endDate, filters: `video==${videoId}`, ...params }).toString()}`;
    const totals = await this.authorized(query({ metrics: "views,averageViewDuration,averageViewPercentage,subscribersGained,likes" }), { method: "GET" });
    if (!totals.ok) throw await parseYouTubeError(totals);
    const totalsBody = (await totals.json()) as { rows?: number[][] };
    const [views = 0, averageViewDuration = 0, averageViewPercentage = 0, subscribersGained = 0, likes = 0] = totalsBody.rows?.[0] ?? [];
    const retentionResponse = await this.authorized(query({ metrics: "audienceWatchRatio", dimensions: "elapsedVideoTimeRatio" }), { method: "GET" });
    const retentionBody = retentionResponse.ok ? ((await retentionResponse.json()) as { rows?: number[][] }) : { rows: [] };
    return metricsSchema.parse({
      views,
      averageViewDurationSec: averageViewDuration,
      averagePercentViewed: averageViewPercentage / 100,
      subscribersGained,
      likes,
      retention: (retentionBody.rows ?? []).map(([at = 0, ratio = 0]) => ({ at, ratio: Math.min(3, ratio) })),
    });
  }
}

function rangeEnd(range: string | null): number {
  // "bytes=0-1048575" → next offset 1048576. No header → nothing was stored yet.
  if (!range) return 0;
  const end = Number(range.split("-")[1]);
  return Number.isFinite(end) ? end + 1 : 0;
}
