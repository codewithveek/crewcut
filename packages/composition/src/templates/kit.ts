import type { EasingSpec, Fill, Keyframe, KeyframeMap, LayerInput, TextAnimation } from "../schema";

/**
 * Building blocks for hand-designed templates: photo, text and shape layers
 * plus the motion vocabulary they share (Ken Burns, rises, wipes, scale-ins).
 * Positions are % of the frame, sizes design px on a 1080 px short side,
 * times ms from the layer's start. Motion follows the house rules: springs
 * and ease-out entrances, nothing enters from scale 0, blur ≤ 20 px.
 */

// ── Placeholder photos ──────────────────────────────────────────────────────

/**
 * A designed stand-in for an empty photo slot: two soft light pools on a
 * gradient, like an out-of-focus photo in the template's colours. Tiny
 * inline SVG, so templates preview and render with no network.
 */
export function placeholderPhoto(colors: readonly [string, string], variant = 0): string {
  const [a, b] = colors;
  const spots = [
    [28, 30, 62, 72],
    [70, 24, 30, 76],
    [50, 70, 22, 34],
    [24, 68, 74, 30],
  ][variant % 4] as [number, number, number, number];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient><radialGradient id='l' cx='.5' cy='.5' r='.5'><stop offset='0' stop-color='#fff' stop-opacity='.42'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></radialGradient><radialGradient id='d' cx='.5' cy='.5' r='.5'><stop offset='0' stop-color='#000' stop-opacity='.28'/><stop offset='1' stop-color='#000' stop-opacity='0'/></radialGradient></defs><rect width='100' height='100' fill='url(#g)'/><circle cx='${spots[0]}' cy='${spots[1]}' r='34' fill='url(#l)'/><circle cx='${spots[2]}' cy='${spots[3]}' r='42' fill='url(#d)'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A monogram stand-in for an empty logo slot (transparent, so it sits on any background). */
export function placeholderLogo(initials: string, colors: readonly [string, string]): string {
  const [ring, ink] = colors;
  const letters = initials.slice(0, 2).toUpperCase().replace(/[<&>'"]/g, "");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><circle cx='100' cy='100' r='92' fill='none' stroke='${ring}' stroke-width='10'/><text x='100' y='100' dy='.35em' text-anchor='middle' font-family='Geist, Inter, sans-serif' font-weight='700' font-size='${letters.length > 1 ? 74 : 96}' fill='${ink}'>${letters}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function isPlaceholderPhoto(src: string): boolean {
  return src.startsWith("data:image/svg+xml");
}

// ── Keyframe helpers ────────────────────────────────────────────────────────

const kf = (atMs: number, value: number, easing: EasingSpec = "move"): Keyframe => ({ atMs: Math.round(atMs), value, easing });

/** Merges keyframe maps; later maps win per property. */
export function motion(...maps: Array<KeyframeMap | undefined | false>): KeyframeMap {
  const out: KeyframeMap = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [property, frames] of Object.entries(map)) {
      const key = property as keyof KeyframeMap;
      out[key] = [...(out[key] ?? []), ...(frames ?? [])].sort((x, y) => x.atMs - y.atMs);
    }
  }
  return out;
}

/** Slow camera drift over a photo for the whole scene (Ken Burns). */
export function kenBurns(durationMs: number, mode: "in" | "out" | "left" | "right" | "up" | "down" = "in", strength = 1): KeyframeMap {
  const zoom = 0.1 * strength;
  const pan = 3.5 * strength;
  const end = durationMs + 400;
  switch (mode) {
    case "out":
      return { scale: [kf(0, 1 + zoom + 0.04, "hold"), kf(end, 1.04, "linear")] };
    case "left":
      return { scale: [kf(0, 1.12, "hold")], offsetX: [kf(0, pan * 10, "hold"), kf(end, -pan * 10, "linear")] };
    case "right":
      return { scale: [kf(0, 1.12, "hold")], offsetX: [kf(0, -pan * 10, "hold"), kf(end, pan * 10, "linear")] };
    case "up":
      return { scale: [kf(0, 1.12, "hold")], offsetY: [kf(0, pan * 10, "hold"), kf(end, -pan * 10, "linear")] };
    case "down":
      return { scale: [kf(0, 1.12, "hold")], offsetY: [kf(0, -pan * 10, "hold"), kf(end, pan * 10, "linear")] };
    default:
      return { scale: [kf(0, 1.04, "hold"), kf(end, 1.04 + zoom, "linear")] };
  }
}

export function fadeIn(atMs = 0, durationMs = 420): KeyframeMap {
  return { opacity: [kf(atMs, 0, "hold"), kf(atMs + durationMs, 1, "entrance")] };
}

export function fadeOut(atMs: number, durationMs = 360): KeyframeMap {
  return { opacity: [kf(atMs, 1, "hold"), kf(atMs + durationMs, 0, "exit")] };
}

/** Rise from below with a fade (springs feel physical; 40–90 px reads on phones). */
export function riseIn(atMs = 0, distance = 70, easing: EasingSpec = "spring-smooth"): KeyframeMap {
  return { offsetY: [kf(atMs, distance, "hold"), kf(atMs + 700, 0, easing)], opacity: [kf(atMs, 0, "hold"), kf(atMs + 320, 1, "entrance")] };
}

export function slideIn(atMs = 0, from: "left" | "right" = "left", distance = 140, easing: EasingSpec = "spring-smooth"): KeyframeMap {
  const sign = from === "left" ? -1 : 1;
  return { offsetX: [kf(atMs, sign * distance, "hold"), kf(atMs + 720, 0, easing)], opacity: [kf(atMs, 0, "hold"), kf(atMs + 280, 1, "entrance")] };
}

/** Scale in from 0.9 (never from 0) with a fade. */
export function scaleIn(atMs = 0, from = 0.9, easing: EasingSpec = "spring-snappy"): KeyframeMap {
  return { scale: [kf(atMs, from, "hold"), kf(atMs + 600, 1, easing)], opacity: [kf(atMs, 0, "hold"), kf(atMs + 260, 1, "entrance")] };
}

/** Punch in from slightly large: impact hits for promo beats. */
export function punchIn(atMs = 0, from = 1.25): KeyframeMap {
  return { scale: [kf(atMs, from, "hold"), kf(atMs + 420, 1, "spring-snappy")], opacity: [kf(atMs, 0, "hold"), kf(atMs + 120, 1, "entrance")], blur: [kf(atMs, 12, "hold"), kf(atMs + 300, 0, "entrance")] };
}

/** Mask reveal from one edge (clip-path). */
export function wipeIn(atMs = 0, from: "left" | "right" | "top" | "bottom" = "bottom", durationMs = 720): KeyframeMap {
  const property = ({ left: "clipRight", right: "clipLeft", top: "clipBottom", bottom: "clipTop" } as const)[from];
  return { [property]: [kf(atMs, 100, "hold"), kf(atMs + durationMs, 0, { bezier: [0.22, 1, 0.36, 1] })] };
}

export function wipeOut(atMs: number, to: "left" | "right" | "top" | "bottom" = "top", durationMs = 520): KeyframeMap {
  const property = ({ left: "clipRight", right: "clipLeft", top: "clipBottom", bottom: "clipTop" } as const)[to];
  return { [property]: [kf(atMs, 0, "hold"), kf(atMs + durationMs, 100, "exit")] };
}

/** Blur-to-sharp reveal (≤ 20 px). */
export function focusIn(atMs = 0, durationMs = 800): KeyframeMap {
  return { blur: [kf(atMs, 18, "hold"), kf(atMs + durationMs, 0, "entrance")], opacity: [kf(atMs, 0, "hold"), kf(atMs + durationMs * 0.6, 1, "entrance")] };
}

/** Grows a bar or underline from its start (scaleX with origin set by the layer). */
export function growX(atMs = 0, durationMs = 640): KeyframeMap {
  return { scaleX: [kf(atMs, 0.001, "hold"), kf(atMs + durationMs, 1, { bezier: [0.65, 0, 0.35, 1] })] };
}

export function textAnimation(preset: TextAnimation["preset"], options: Partial<Omit<TextAnimation, "preset">> = {}): TextAnimation {
  return { unit: "word", delayMs: 0, staggerMs: 60, durationMs: 620, easing: "entrance", ...options, preset };
}

// ── Layers ──────────────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL: Box = { x: 50, y: 50, w: 100, h: 100 };

export function photo(input: {
  id: string;
  slot: string;
  src: string;
  box?: Box;
  radius?: number;
  keyframes?: KeyframeMap;
  startMs?: number;
  durationMs?: number;
  filter?: { preset: "mono" | "noir" | "sepia" | "warm" | "cool" | "vivid" | "fade" | "dramatic" | "vintage" | "dreamy"; intensity: number };
  adjust?: { brightness?: number; contrast?: number; saturation?: number; temperature?: number; vignette?: number };
  name?: string;
  shadow?: boolean;
  fit?: "cover" | "contain";
}): LayerInput {
  const box = input.box ?? FULL;
  return {
    id: input.id,
    type: "image",
    name: input.name ?? `Photo (${input.slot})`,
    slot: input.slot,
    src: input.src,
    fit: input.fit ?? "cover",
    radius: input.radius ?? 0,
    transform: { x: box.x, y: box.y, width: box.w, height: box.h },
    keyframes: input.keyframes ?? {},
    ...(input.startMs !== undefined ? { startMs: input.startMs } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.filter ? { filter: input.filter } : {}),
    ...(input.adjust ? { adjust: input.adjust } : {}),
    ...(input.shadow ? { shadow: { color: "#00000059", blur: 60, x: 0, y: 24 } } : {}),
  } as LayerInput;
}

export interface TextInput {
  id: string;
  text: string;
  slot?: string;
  x: number;
  y: number;
  size: number;
  font?: "display" | "body" | "mono" | (string & {});
  weight?: number;
  color: string;
  accentColor?: string;
  align?: "left" | "center" | "right";
  maxWidth?: number;
  tracking?: number;
  leading?: number;
  uppercase?: boolean;
  italic?: boolean;
  /** 0..1 horizontal anchor; defaults from align. */
  anchorX?: number;
  anchorY?: number;
  animation?: TextAnimation;
  keyframes?: KeyframeMap;
  startMs?: number;
  durationMs?: number;
  background?: string;
  padding?: number;
  radius?: number;
  highlight?: string;
  shadow?: boolean;
  name?: string;
}

export function text(input: TextInput): LayerInput {
  const align = input.align ?? "center";
  return {
    id: input.id,
    type: "text",
    name: input.name ?? (input.slot ? `Text (${input.slot})` : "Text"),
    ...(input.slot ? { slot: input.slot } : {}),
    text: input.text,
    style: {
      font: input.font ?? "display",
      size: input.size,
      weight: input.weight ?? 700,
      color: input.color,
      ...(input.accentColor ? { accentColor: input.accentColor } : {}),
      align,
      tracking: input.tracking ?? -0.02,
      leading: input.leading ?? 1.05,
      uppercase: input.uppercase ?? false,
      italic: input.italic ?? false,
      maxWidth: input.maxWidth ?? 84,
      ...(input.background ? { background: input.background, padding: input.padding ?? 24, radius: input.radius ?? 0 } : {}),
      ...(input.highlight ? { highlight: input.highlight } : {}),
    },
    transform: { x: input.x, y: input.y, anchorX: input.anchorX ?? (align === "left" ? 0 : align === "right" ? 1 : 0.5), anchorY: input.anchorY ?? 0.5 },
    keyframes: input.keyframes ?? {},
    ...(input.animation ? { animation: input.animation } : {}),
    ...(input.startMs !== undefined ? { startMs: input.startMs } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.shadow ? { shadow: { color: "#0000008c", blur: 30, x: 0, y: 6 } } : {}),
  } as LayerInput;
}

export function rect(input: { id: string; box: Box; fill: Fill; radius?: number; keyframes?: KeyframeMap; ambient?: { kind: "float" | "drift" | "pulse" | "sway"; amplitude: number; periodMs: number }; originX?: number; originY?: number; startMs?: number; durationMs?: number; name?: string; shape?: "rect" | "ellipse" | "ring"; stroke?: string; strokeWidth?: number; blend?: "normal" | "multiply" | "screen" | "overlay" | "soft-light" }): LayerInput {
  return {
    id: input.id,
    type: "shape",
    name: input.name ?? "Shape",
    shape: input.shape ?? "rect",
    fill: input.fill,
    radius: input.radius ?? 0,
    ...(input.stroke ? { stroke: input.stroke, strokeWidth: input.strokeWidth ?? 4 } : {}),
    transform: { x: input.box.x, y: input.box.y, width: input.box.w, height: input.box.h, originX: input.originX ?? 0.5, originY: input.originY ?? 0.5 },
    keyframes: input.keyframes ?? {},
    ...(input.ambient ? { ambient: input.ambient } : {}),
    ...(input.blend ? { blendMode: input.blend } : {}),
    ...(input.startMs !== undefined ? { startMs: input.startMs } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  } as LayerInput;
}

/** Darkens one edge so text stays readable over any photo. */
export function scrim(id: string, edge: "bottom" | "top" | "left" | "full", strength = 0.72, color = "#000000"): LayerInput {
  const alpha = Math.round(Math.min(1, strength) * 255).toString(16).padStart(2, "0");
  const solid = `${color}${alpha}`;
  const clear = `${color}00`;
  const fill: Fill =
    edge === "full"
      ? `${color}${alpha}`
      : { gradient: { kind: "linear", angle: edge === "bottom" ? 180 : edge === "top" ? 0 : 90, stops: edge === "left" ? [{ color: solid, at: 0 }, { color: clear, at: 0.75 }] : [{ color: clear, at: 0.3 }, { color: solid, at: 1 }] } };
  return rect({ id, box: FULL, fill, name: "Scrim" });
}
