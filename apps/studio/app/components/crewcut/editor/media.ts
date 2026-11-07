import { appPath } from "@agent-native/core/client/api-path";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import type { LayerDraft, Transition } from "@crewcut/composition";
import { useEffect, useMemo, useState } from "react";

import type { AssetLike, LibraryAudio } from "./commands";

/**
 * Media plumbing for the editor: the asset library, uploads (with the
 * duration probed in the browser), waveform peaks decoded once per file,
 * video poster frames, and the payload carried by drag-and-drop.
 */

export interface AssetDto extends AssetLike {
  videoId: string | null;
  kind: string;
  mime: string;
  bytes: number;
  source: string;
  createdAt: string;
}

interface AssetPage {
  assets: AssetDto[];
  total: number;
  nextOffset: number | null;
}

/**
 * Everything the person can use (this video's media first, then their
 * library and other projects), newest first, searched on the server, one page
 * at a time for infinite scroll. Each page is fetched once (offset paging),
 * so scrolling far never re-downloads what's already shown. The key starts
 * with "action", "list-assets", so every media change that refreshes asset
 * lists refreshes this one too.
 */
export function useAssets(videoId: string, options: { mediaType?: "visual" | "image" | "video" | "audio"; query?: string; pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 60;
  const search = options.query?.trim() ?? "";
  const params = { videoId, scope: "all", ...(options.mediaType ? { mediaType: options.mediaType } : {}), ...(search ? { query: search } : {}) };
  const result = useInfiniteQuery({
    queryKey: ["action", "list-assets", params, "pages", pageSize],
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: ({ pageParam, signal }) => callAction("list-assets" as never, { ...params, limit: pageSize, offset: pageParam } as never, { method: "GET", signal }) as Promise<AssetPage>,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const pages = result.data?.pages;
  // New uploads shift the offsets of later pages; an item can arrive twice, so keep the first.
  const assets = useMemo(() => {
    const seen = new Set<string>();
    return (pages ?? []).flatMap((page) => page.assets).filter((asset) => (seen.has(asset.id) ? false : (seen.add(asset.id), true)));
  }, [pages]);
  const total = pages?.[pages.length - 1]?.total ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = result;
  return {
    assets,
    total,
    loading: result.isLoading,
    error: result.error,
    refetch: result.refetch,
    hasMore: Boolean(hasNextPage),
    loadingMore: isFetchingNextPage,
    /** Safe to call repeatedly: never starts a second request or cancels the one in flight. */
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage({ cancelRefetch: false });
    },
    /** Changes when the list starts over (for the infinite-scroll sentinel). */
    listKey: `${videoId}|${options.mediaType ?? ""}|${search}`,
  };
}

export interface LibraryItemDto extends LibraryAudio {
  mood: string;
  bpm: number | null;
  url: string;
  /** Catalog items ("cat:…") come in Free or Pro packs; built-in sounds are free. */
  tier?: "free" | "pro";
  packName?: string | null;
}

export function useAudioLibrary() {
  const query = useActionQuery("list-audio-library", {} as never);
  return { items: (query.data as { items?: LibraryItemDto[] } | undefined)?.items ?? [], loading: query.isLoading };
}

// ── Stock photos ────────────────────────────────────────────────────────────

export type StockOrientation = "portrait" | "landscape" | "square";

export interface StockPhotoDto {
  id: number;
  width: number;
  height: number;
  alt: string;
  avgColor: string;
  thumbUrl: string;
  previewUrl: string;
  photographer: string;
  photographerUrl: string;
  pageUrl: string;
  credit: string;
}

interface StockPage {
  enabled: boolean;
  photos: StockPhotoDto[];
  total: number;
  page: number;
  hasMore: boolean;
}

/** Free stock photos from Pexels, searched on the server (curated picks while the search is empty), a page at a time. */
export function useStockPhotos(options: { query: string; orientation?: StockOrientation | undefined; enabled?: boolean }) {
  const query = options.query.trim();
  const result = useInfiniteQuery({
    queryKey: ["crewcut-stock", query, options.orientation ?? ""],
    enabled: options.enabled ?? true,
    initialPageParam: 1,
    staleTime: 10 * 60 * 1000,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam, signal }) =>
      callAction("search-stock-photos" as never, { ...(query ? { query } : {}), ...(options.orientation && query ? { orientation: options.orientation } : {}), page: pageParam, perPage: 30 } as never, { method: "GET", signal }) as Promise<StockPage>,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
  const pages = result.data?.pages;
  // Pexels can repeat a photo across pages; keep the first.
  const photos = useMemo(() => {
    const seen = new Set<number>();
    return (pages ?? []).flatMap((page) => page.photos).filter((photo) => (seen.has(photo.id) ? false : (seen.add(photo.id), true)));
  }, [pages]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = result;
  return {
    photos,
    enabled: pages?.[0]?.enabled ?? true,
    total: pages?.[0]?.total ?? 0,
    loading: result.isLoading,
    searching: result.isFetching && !result.isFetchingNextPage,
    error: result.error,
    hasMore: Boolean(hasNextPage),
    loadingMore: isFetchingNextPage,
    // Every Pexels request counts against the hourly limit: never double-fetch a page.
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage({ cancelRefetch: false });
    },
    listKey: `${query}|${options.orientation ?? ""}`,
  };
}

export const ACCEPTED_MEDIA = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,audio/webm";

/** Reads a media file's duration in the browser (the server never decodes uploads). */
export function probeDuration(file: Blob): Promise<number | null> {
  if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      if (Number.isFinite(element.duration)) done(Math.round(element.duration * 1000));
      else {
        // MediaRecorder WebM reports Infinity until it is seeked to the end.
        element.currentTime = 1e7;
        element.ontimeupdate = () => done(Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : null);
      }
    };
    element.onerror = () => done(null);
    element.src = url;
    window.setTimeout(() => done(null), 8000);
  });
}

export async function uploadMedia(file: Blob, options: { videoId?: string; role?: string; label?: string } = {}): Promise<AssetDto> {
  const durationMs = await probeDuration(file);
  const params = new URLSearchParams();
  if (options.videoId) params.set("videoId", options.videoId);
  if (options.role) params.set("role", options.role);
  params.set("label", (options.label ?? (file instanceof File ? file.name.replace(/\.[^.]+$/, "") : "Recording")).slice(0, 120));
  if (durationMs) params.set("durationMs", String(durationMs));
  const response = await fetch(appPath(`/api/assets?${params.toString()}`), { method: "POST", body: file, credentials: "include" });
  const body = (await response.json().catch(() => ({}))) as { assetId?: string; kind?: string; mime?: string; mediaType?: string; bytes?: number; label?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !body.assetId || !body.url) throw new Error(body.error?.message ?? `Upload failed (${response.status})`);
  const mediaType = (body.mediaType === "image" || body.mediaType === "video" ? body.mediaType : "audio") as AssetDto["mediaType"];
  return {
    id: body.assetId,
    videoId: options.videoId ?? null,
    kind: body.kind ?? mediaType,
    mediaType,
    label: body.label ?? "Upload",
    mime: body.mime ?? file.type,
    bytes: body.bytes ?? file.size,
    durationMs,
    url: body.url,
    source: "upload",
    createdAt: new Date().toISOString(),
  };
}

// ── Waveforms ───────────────────────────────────────────────────────────────

export const PEAKS_PER_SECOND = 50;
const peakCache = new Map<string, Promise<Float32Array | null>>();

/** The audio's loudness envelope (PEAKS_PER_SECOND values per second, 0..1), decoded once per file. */
export function loadPeaks(url: string): Promise<Float32Array | null> {
  return decodePeaks(url);
}

function decodePeaks(url: string): Promise<Float32Array | null> {
  const key = url.split("?")[0] ?? url;
  let promise = peakCache.get(key);
  if (!promise) {
    promise = (async () => {
      try {
        const bytes = await (await fetch(url)).arrayBuffer();
        const context = new OfflineAudioContext(1, 1, 22_050);
        const audio = await context.decodeAudioData(bytes);
        const channel = audio.getChannelData(0);
        const bucket = Math.max(1, Math.floor(audio.sampleRate / PEAKS_PER_SECOND));
        const peaks = new Float32Array(Math.ceil(channel.length / bucket));
        let max = 0;
        for (let index = 0; index < peaks.length; index += 1) {
          let peak = 0;
          const end = Math.min(channel.length, (index + 1) * bucket);
          for (let sample = index * bucket; sample < end; sample += 4) peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
          peaks[index] = peak;
          max = Math.max(max, peak);
        }
        if (max > 0) for (let index = 0; index < peaks.length; index += 1) peaks[index] = (peaks[index] ?? 0) / max;
        return peaks;
      } catch {
        return null;
      }
    })();
    peakCache.set(key, promise);
  }
  return promise;
}

/** Peaks (0..1) for the visible part of a clip: source offset and speed applied. */
export function usePeaks(url: string | null | undefined, trimStartMs: number, durationMs: number, playbackRate = 1, buckets = 120): number[] | null {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    let alive = true;
    if (!url) {
      setPeaks(null);
      return;
    }
    void decodePeaks(url).then((value) => alive && setPeaks(value));
    return () => {
      alive = false;
    };
  }, [url]);
  if (!peaks) return null;
  const out: number[] = [];
  const count = Math.max(8, Math.min(600, Math.round(buckets)));
  for (let index = 0; index < count; index += 1) {
    const sourceMs = trimStartMs + ((index + 0.5) / count) * durationMs * playbackRate;
    out.push(peaks[Math.floor((sourceMs / 1000) * PEAKS_PER_SECOND)] ?? 0);
  }
  return out;
}

// ── Video frames ────────────────────────────────────────────────────────────

const frameCache = new Map<string, Promise<string | null>>();
let frameQueue: Promise<unknown> = Promise.resolve();

function captureFrame(url: string, atMs: number, height: number): Promise<string | null> {
  const key = `${url.split("?")[0]}#${Math.round(atMs / 100)}#${height}`;
  let promise = frameCache.get(key);
  if (!promise) {
    // One seek at a time: decoders are scarce, and order keeps the strip filling left to right.
    promise = frameQueue.then(
      () =>
        new Promise<string | null>((resolve) => {
          const video = document.createElement("video");
          video.crossOrigin = "anonymous";
          video.muted = true;
          video.preload = "auto";
          const finish = (value: string | null) => {
            video.removeAttribute("src");
            video.load();
            resolve(value);
          };
          video.onloadedmetadata = () => {
            video.currentTime = Math.min(Math.max(0, atMs / 1000), Math.max(0, video.duration - 0.05));
          };
          video.onseeked = () => {
            try {
              const canvas = document.createElement("canvas");
              canvas.height = height;
              canvas.width = Math.round((video.videoWidth / Math.max(1, video.videoHeight)) * height);
              canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
              finish(canvas.toDataURL("image/jpeg", 0.7));
            } catch {
              finish(null);
            }
          };
          video.onerror = () => finish(null);
          window.setTimeout(() => finish(null), 6000);
          video.src = url;
        }),
    );
    frameQueue = promise.catch(() => null);
    frameCache.set(key, promise);
  }
  return promise;
}

export function useVideoFrames(url: string | null | undefined, timesMs: number[], height = 72): Array<string | null> {
  const signature = timesMs.map((time) => Math.round(time / 100)).join(",");
  const [frames, setFrames] = useState<Array<string | null>>([]);
  useEffect(() => {
    let alive = true;
    if (!url) return;
    void Promise.all(timesMs.map((time) => captureFrame(url, time, height))).then((values) => alive && setFrames(values));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, signature, height]);
  return frames;
}

// ── Drag and drop ───────────────────────────────────────────────────────────

export const DRAG_MIME = "application/x-crewcut";

export type DragPayload =
  | { type: "asset"; asset: AssetLike }
  | { type: "stock"; photo: StockPhotoDto; label: string }
  | { type: "library"; item: LibraryAudio }
  | { type: "element"; layer: LayerDraft; label: string }
  | { type: "transition"; transition: Transition; label: string }
  | { type: "motion"; presetId: string; label: string }
  | { type: "filter"; preset: string; label: string };

let current: DragPayload | null = null;

/** dataTransfer can't be read during dragover, so the payload also lives here. */
export function startDrag(event: React.DragEvent, payload: DragPayload): void {
  current = payload;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.setData("text/plain", "label" in payload ? payload.label : payload.type === "asset" ? payload.asset.label : payload.item.label);
}

export function endDrag(): void {
  current = null;
}

export function dragPayload(event?: React.DragEvent | DragEvent): DragPayload | null {
  if (current) return current;
  const raw = event?.dataTransfer?.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

/** True for Crewcut drags even while dataTransfer is unreadable (dragover from another page). */
export function isCrewcutDrag(event: React.DragEvent | DragEvent): boolean {
  return Boolean(current) || Array.from(event.dataTransfer?.types ?? []).includes(DRAG_MIME);
}

export function hasFiles(event: React.DragEvent | DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}
