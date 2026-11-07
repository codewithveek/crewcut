/**
 * Units used by the composition:
 * - time: integer-friendly milliseconds (frame-accurate at any fps)
 * - position/size: percent of the frame (ratio-independent, so auto-reframe works)
 * - type sizes, offsets, radii, blur: "design px" measured against a 1080px short side
 */
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:5", "4:3", "3:4", "21:9", "2:3"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** Short side is always 1080 so design px stay comparable across formats. */
export const FRAME_SIZE: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "4:3": { width: 1440, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
  "21:9": { width: 2520, height: 1080 },
  "2:3": { width: 1080, height: 1620 },
};

/** Where each format is used, for format pickers. */
export const ASPECT_RATIO_INFO: Record<AspectRatio, { label: string; use: string }> = {
  "16:9": { label: "16:9", use: "YouTube, landscape" },
  "9:16": { label: "9:16", use: "Shorts, Reels, TikTok" },
  "1:1": { label: "1:1", use: "Square feed" },
  "4:5": { label: "4:5", use: "Instagram feed" },
  "4:3": { label: "4:3", use: "Classic, slides" },
  "3:4": { label: "3:4", use: "Portrait feed" },
  "21:9": { label: "21:9", use: "Cinematic wide" },
  "2:3": { label: "2:3", use: "Pinterest, poster" },
};

export const FPS_OPTIONS = [24, 25, 30, 50, 60] as const;
export const DEFAULT_FPS = 30;
export const DESIGN_SHORT_SIDE = 1080;

/**
 * Export sizes, named by the short side like most editors (a 9:16 "1080p"
 * video is 1080×1920). Layouts are % of the frame and design px scale with the
 * short side, so any size renders the same picture, just sharper or lighter.
 */
export const EXPORT_RESOLUTIONS = [
  { id: "480p", shortSide: 480, label: "480p" },
  { id: "720p", shortSide: 720, label: "720p" },
  { id: "1080p", shortSide: 1080, label: "1080p" },
  { id: "1440p", shortSide: 1440, label: "2K" },
  { id: "2160p", shortSide: 2160, label: "4K" },
] as const;
export type ExportResolution = (typeof EXPORT_RESOLUTIONS)[number]["id"];
export const EXPORT_RESOLUTION_IDS = EXPORT_RESOLUTIONS.map((entry) => entry.id) as [ExportResolution, ...ExportResolution[]];
export const DEFAULT_EXPORT_RESOLUTION: ExportResolution = "1080p";
/** Longest side an export may have (H.264 players reliably decode up to 4096 px). */
export const MAX_EXPORT_SIDE = 4096;

/** The frame size of an export: short side from the resolution, long side capped, both even (H.264 needs even sizes). */
export function exportSize(width: number, height: number, resolution: ExportResolution): { width: number; height: number } {
  const target = EXPORT_RESOLUTIONS.find((entry) => entry.id === resolution)?.shortSide ?? DESIGN_SHORT_SIDE;
  const scale = Math.min(target / Math.min(width, height), MAX_EXPORT_SIDE / Math.max(width, height));
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

export function designScale(width: number, height: number): number {
  return Math.min(width, height) / DESIGN_SHORT_SIDE;
}

export function msToFrame(ms: number, fps: number): number {
  return Math.round((ms * fps) / 1000);
}

export function frameToMs(frame: number, fps: number): number {
  return (frame * 1000) / fps;
}

/** Snaps a time to the nearest frame boundary. */
export function quantizeMs(ms: number, fps: number): number {
  return frameToMs(msToFrame(ms, fps), fps);
}

export function durationInFrames(durationMs: number, fps: number): number {
  return Math.max(1, Math.ceil((durationMs * fps) / 1000 - 1e-9));
}

export type TimecodeMode = "ms" | "frames";

/** `00:00:01.250` (ms) or `00:00:01:07` (frames). Always fixed width for tabular numbers. */
export function formatTimecode(ms: number, options: { fps: number; mode?: TimecodeMode }): string {
  const sign = ms < 0 ? "-" : "";
  const absolute = Math.abs(ms);
  const totalSeconds = Math.floor(absolute / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const head = `${sign}${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}`;
  if (options.mode === "frames") {
    const frame = Math.floor(((absolute % 1000) * options.fps) / 1000 + 1e-6);
    return `${head}:${pad(frame, 2)}`;
  }
  return `${head}.${pad(Math.round(absolute % 1000) % 1000, 3)}`;
}

/** Parses `hh:mm:ss.mmm`, `mm:ss.mmm`, `ss.mmm`, `hh:mm:ss:ff` (with fps) or plain ms ("1250ms"). */
export function parseTimecode(input: string, fps: number): number | null {
  const text = input.trim();
  const msMatch = /^(-?\d+(?:\.\d+)?)\s*ms$/i.exec(text);
  if (msMatch?.[1]) return Number(msMatch[1]);
  const secondsMatch = /^(-?\d+(?:\.\d+)?)\s*s$/i.exec(text);
  if (secondsMatch?.[1]) return Number(secondsMatch[1]) * 1000;
  const parts = text.split(":");
  if (parts.length === 4) {
    const [h, m, s, f] = parts.map(Number);
    if ([h, m, s, f].some((value) => value === undefined || Number.isNaN(value))) return null;
    return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 1000 + frameToMs(f ?? 0, fps);
  }
  if (parts.length < 1 || parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    const value = Number(part);
    if (Number.isNaN(value)) return null;
    total = total * 60 + value;
  }
  return Math.round(total * 1000);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
