import { readFileSync } from "node:fs";
import path from "node:path";

import type { CaptionClip, EasingSpec, Keyframe, KeyframeMap, LayerInput, TextAnimation } from "@crewcut/composition";

import type { Recording } from "./screen";

/** Crewcut's own look for its films: the logo's ink, paper and cut orange; Geist type. */
export const INK = "#0D0D0F";
export const INK_2 = "#141418";
export const SURFACE = "#1B1B20";
export const PAPER = "#F5F3EE";
export const DIM = "#9A9AA3";
export const CUT = "#FF5B2E";
export const HAIRLINE = "#ffffff1f";
/** Timeline clip colours, as the editor draws them. */
export const KIND = { captions: "#3c6fe6", main: "#6152e8", voice: "#d84d86", music: "#21a06b", overlay: "#c98a1a" };

export const FRAME = { width: 1920, height: 1080 };

export const kf = (atMs: number, value: number, easing: EasingSpec = "move"): Keyframe => ({ atMs: Math.round(atMs), value, easing });
export const IN_OUT: EasingSpec = { bezier: [0.65, 0, 0.35, 1] };
export const OUT: EasingSpec = { bezier: [0.16, 1, 0.3, 1] };

export function merge(...maps: Array<KeyframeMap | undefined | false>): KeyframeMap {
  const out: KeyframeMap = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [key, frames] of Object.entries(map)) {
      const property = key as keyof KeyframeMap;
      out[property] = [...(out[property] ?? []), ...(frames ?? [])].sort((a, b) => a.atMs - b.atMs);
    }
  }
  return out;
}

export const fadeIn = (at = 0, dur = 380): KeyframeMap => ({ opacity: [kf(at, 0, "hold"), kf(at + dur, 1, "entrance")] });
export const fadeOut = (at: number, dur = 320): KeyframeMap => ({ opacity: [kf(at, 1, "hold"), kf(at + dur, 0, "exit")] });
export const rise = (at = 0, distance = 60, dur = 700): KeyframeMap => ({ offsetY: [kf(at, distance, "hold"), kf(at + dur, 0, "spring-smooth")], opacity: [kf(at, 0, "hold"), kf(at + 300, 1, "entrance")] });
/** Leave upwards with a little blur (the way text rose in, reversed). */
export const exitUp = (at: number, distance = 50, dur = 420): KeyframeMap => ({
  offsetY: [kf(at, 0, "hold"), kf(at + dur, -distance, "exit")],
  opacity: [kf(at, 1, "hold"), kf(at + dur, 0, "exit")],
  blur: [kf(at, 0, "hold"), kf(at + dur, 8, "exit")],
});
export const pop = (at = 0, from = 0.9): KeyframeMap => ({ scale: [kf(at, from, "hold"), kf(at + 600, 1, "spring-snappy")], opacity: [kf(at, 0, "hold"), kf(at + 240, 1, "entrance")] });
export const words = (options: Partial<TextAnimation> = {}): TextAnimation => ({ unit: "word", preset: "mask-rise", delayMs: 0, staggerMs: 60, durationMs: 620, easing: "spring-smooth", ...options });

export interface TextOptions {
  font?: string;
  weight?: number;
  color?: string;
  accent?: string;
  align?: "left" | "center" | "right";
  tracking?: number;
  leading?: number;
  maxWidth?: number;
  italic?: boolean;
  uppercase?: boolean;
  startMs?: number;
  durationMs?: number;
  keyframes?: KeyframeMap;
  animation?: TextAnimation;
  anchorX?: number;
  anchorY?: number;
  name?: string;
  background?: string;
  padding?: number;
  radius?: number;
  shadow?: boolean;
}

export function text(id: string, value: string, x: number, y: number, size: number, options: TextOptions = {}): LayerInput {
  const align = options.align ?? "left";
  return {
    id,
    type: "text",
    name: options.name ?? value.replace(/\*/g, "").slice(0, 40),
    text: value,
    style: {
      font: options.font ?? "Geist",
      size,
      weight: options.weight ?? 600,
      color: options.color ?? PAPER,
      accentColor: options.accent ?? CUT,
      align,
      tracking: options.tracking ?? -0.035,
      leading: options.leading ?? 1.04,
      maxWidth: options.maxWidth ?? 86,
      italic: options.italic ?? false,
      uppercase: options.uppercase ?? false,
      ...(options.background ? { background: options.background, padding: options.padding ?? 20, radius: Math.min(200, options.radius ?? 200) } : {}),
    },
    transform: { x, y, anchorX: options.anchorX ?? (align === "left" ? 0 : align === "right" ? 1 : 0.5), anchorY: options.anchorY ?? 0.5 },
    keyframes: options.keyframes ?? {},
    ...(options.animation ? { animation: options.animation } : {}),
    ...(options.startMs !== undefined ? { startMs: options.startMs } : {}),
    ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
    ...(options.shadow ? { shadow: { color: "#000000a6", blur: 30, x: 0, y: 8 } } : {}),
  } as LayerInput;
}

export function rect(id: string, box: { x: number; y: number; w: number; h: number }, fill: unknown, extra: Record<string, unknown> = {}): LayerInput {
  const { originX, originY, anchorX, anchorY, ...rest } = extra as { originX?: number; originY?: number; anchorX?: number; anchorY?: number };
  return {
    id,
    type: "shape",
    shape: "rect",
    fill,
    transform: { x: box.x, y: box.y, width: box.w, height: box.h, ...(originX !== undefined ? { originX } : {}), ...(originY !== undefined ? { originY } : {}), ...(anchorX !== undefined ? { anchorX } : {}), ...(anchorY !== undefined ? { anchorY } : {}) },
    ...rest,
  } as LayerInput;
}

export function glow(id: string, x: number, y: number, w: number, h: number, color = CUT, alpha = "33", extra: Record<string, unknown> = {}): LayerInput {
  return {
    id,
    type: "shape",
    shape: "ellipse",
    fill: { gradient: { kind: "radial", angle: 0, stops: [{ color: `${color}${alpha}`, at: 0 }, { color: `${color}00`, at: 1 }] } },
    transform: { x, y, width: w, height: h },
    ambient: { kind: "drift", amplitude: 24, periodMs: 12000 },
    depth: 0.3,
    ...extra,
  } as LayerInput;
}

/** A dark caption pill naming the action, with one accent word (Editorial's "caption pill"). */
export function pill(id: string, value: string, x: number, y: number, size = 40, options: { startMs?: number; durationMs?: number; keyframes?: KeyframeMap; anchorX?: number } = {}): LayerInput {
  return text(id, value, x, y, size, {
    font: "Geist",
    weight: 600,
    tracking: -0.02,
    background: "#0D0D0Fe6",
    padding: 26,
    radius: 200,
    anchorX: options.anchorX ?? 0,
    shadow: true,
    startMs: options.startMs,
    durationMs: options.durationMs,
    keyframes: options.keyframes ?? merge(rise(0, 30, 600)),
    maxWidth: 70,
  });
}

// ── The mark ────────────────────────────────────────────────────────────────

const arc = (d: string, color: string, width = 17) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"/></svg>`)}`;
export const MARK_UPPER = arc("M74.51 29.43 A32 32 0 0 0 18 50", PAPER);
export const MARK_LOWER = arc("M18 50 A32 32 0 0 0 74.51 70.57", CUT);

/** The split C at a size (design px), drawing in from `at`, its lower half cut loose and slipping at `at + 640`. */
export function mark(id: string, cx: number, cy: number, sizePx: number, at = 0): LayerInput[] {
  const box = { x: cx, y: cy, width: (sizePx / FRAME.width) * 100, height: (sizePx / FRAME.height) * 100 };
  const slipAt = at + 640;
  return [
    { id: `${id}-upper`, type: "image", src: MARK_UPPER, fit: "contain", alt: "Crewcut", transform: box, keyframes: { clipLeft: [kf(at, 100, "hold"), kf(at + 360, 0, { bezier: [0.3, 0, 0.2, 1] })] } } as LayerInput,
    {
      id: `${id}-lower`,
      type: "image",
      src: MARK_LOWER,
      fit: "contain",
      alt: "",
      transform: box,
      keyframes: {
        clipRight: [kf(at + 280, 100, "hold"), kf(at + 620, 0, { bezier: [0.2, 0, 0.2, 1] })],
        offsetX: [kf(slipAt, 0, "hold"), kf(slipAt + 520, Math.round(sizePx * 0.06), "spring-snappy")],
        offsetY: [kf(slipAt, 0, "hold"), kf(slipAt + 520, Math.round(sizePx * 0.04), "spring-snappy")],
      },
    } as LayerInput,
  ];
}

// ── Media ───────────────────────────────────────────────────────────────────

const STORAGE = path.resolve(process.env.CREWCUT_STORAGE_DIR ?? path.join(import.meta.dirname, "../../../../storage"));

export function loadRecording(name: string, sourceDir: string): Recording {
  const events = JSON.parse(readFileSync(path.join(sourceDir, name, "events.json"), "utf8")) as Omit<Recording, "assetId">;
  return { ...events, assetId: `film-${name}` };
}

export interface VoLine {
  text: string;
  durationMs: number;
  words: Array<{ text: string; start: number; end: number }>;
}

export function loadVo(audioDir: string): Record<string, VoLine> {
  return JSON.parse(readFileSync(path.join(audioDir, "vo.json"), "utf8")) as Record<string, VoLine>;
}

export interface Cue {
  id: string;
  atMs: number;
}

/** Voice clips for the lines at their cue times, and caption clips (one per sentence chunk) from the word timings. */
export function voiceAndCaptions(vo: Record<string, VoLine>, cues: Cue[], options: { volume?: number; captionsMaxWords?: number } = {}) {
  const voice = cues.map((cue) => {
    const line = vo[cue.id];
    if (!line) throw new Error(`No narration line ${cue.id}`);
    return { id: `vo-${cue.id}`, src: `asset:film-vo-${cue.id}`, startMs: cue.atMs, durationMs: line.durationMs + 120, volume: options.volume ?? 1, text: line.text, lineId: cue.id };
  });
  const captions: CaptionClip[] = [];
  const max = options.captionsMaxWords ?? 7;
  for (const cue of cues) {
    const line = vo[cue.id]!;
    let chunk: VoLine["words"] = [];
    const flush = () => {
      if (!chunk.length) return;
      const startMs = Math.round(cue.atMs + chunk[0]!.start * 1000);
      const endMs = Math.round(cue.atMs + chunk[chunk.length - 1]!.end * 1000 + 180);
      captions.push({
        id: `cap-${cue.id}-${captions.length}`,
        startMs,
        durationMs: endMs - startMs,
        text: chunk.map((word) => word.text).join(" "),
        words: chunk.map((word) => ({ text: word.text, startMs: Math.round(cue.atMs + word.start * 1000), endMs: Math.round(cue.atMs + word.end * 1000) })),
        emphasis: [],
      });
      chunk = [];
    };
    for (const word of line.words) {
      chunk.push(word);
      if (chunk.length >= max || /[.?!:;]$/.test(word.text)) flush();
    }
    flush();
  }
  // Cues end where the next one starts, so the caption track never overlaps.
  captions.sort((a, b) => a.startMs - b.startMs);
  captions.forEach((caption, index) => {
    const next = captions[index + 1];
    if (next && caption.startMs + caption.durationMs > next.startMs) caption.durationMs = Math.max(1, next.startMs - caption.startMs);
  });
  return { voice, captions };
}

export function sfx(name: string, atMs: number, volume = 0.5, durationMs = 2000) {
  return { id: `sfx-${name}-${Math.round(atMs)}`, src: `asset:film-sfx-${name}`, startMs: Math.max(0, Math.round(atMs)), durationMs, volume, text: name };
}

export function storageDir(): string {
  return STORAGE;
}

/** Sound effects spread over as few SFX tracks as needed (clips on one track can't overlap). */
export function sfxTracks(clips: Array<{ startMs: number; durationMs: number }>, prefix = "track-sfx") {
  const lanes: Array<typeof clips> = [];
  for (const clip of [...clips].sort((a, b) => a.startMs - b.startMs)) {
    const lane = lanes.find((existing) => {
      const last = existing[existing.length - 1]!;
      return last.startMs + last.durationMs <= clip.startMs;
    });
    if (lane) lane.push(clip);
    else lanes.push([clip]);
  }
  return lanes.map((laneClips, index) => ({ id: `${prefix}-${index + 1}`, name: index ? `SFX ${index + 1}` : "SFX", kind: "audio", role: "sfx", clips: laneClips }));
}
