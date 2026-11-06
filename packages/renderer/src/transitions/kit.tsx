import React from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Palette } from "@crewcut/composition";
import { createSeededRandom, cubicBezier, springProgress } from "@crewcut/motion";

/**
 * Small, deterministic building blocks for transitions. Every value is a pure
 * function of progress, so the editor preview, the panel thumbnails and the
 * render worker draw identical frames.
 */

// ── Math ────────────────────────────────────────────────────────────────────

export const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
/** 0 before `a`, 1 after `b`, linear between. */
export const seg = (x: number, a: number, b: number) => clamp01((x - a) / (b - a));
/** 0 → 1 → 0 over 0..1. */
export const bell = (x: number) => Math.sin(Math.PI * clamp01(x));
export const mix = (a: number, b: number, k: number) => a + (b - a) * k;
export const smooth = (a: number, b: number, x: number) => {
  const k = seg(x, a, b);
  return k * k * (3 - 2 * k);
};

/** Curves from the motion system (Emil Kowalski's set), plus two for camera moves. */
export const ease = {
  /** Strong ease-out: arrivals. */
  out: cubicBezier([0.23, 1, 0.32, 1]),
  /** Strong ease-in-out: on-screen moves. */
  inOut: cubicBezier([0.77, 0, 0.175, 1]),
  /** Accelerating into a cut (a camera leaving), never for UI arrivals. */
  in: cubicBezier([0.32, 0, 0.67, 0]),
  /** Even in-out for shapes that must sweep at a steady pace. */
  soft: cubicBezier([0.45, 0, 0.55, 1]),
  cubic: cubicBezier([0.65, 0, 0.35, 1]),
};

/**
 * A spring released at x = 0 that lands exactly on 1 at x = 1. `response` is
 * a fraction of the segment, so the bounce scales with the transition length.
 */
export function settle(x: number, segmentMs: number, dampingRatio: number, response: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const seconds = Math.max(0.05, segmentMs / 1000);
  const value = springProgress({ dampingRatio, response: Math.max(0.05, response * seconds) }, x * seconds);
  const landing = seg(x, 0.82, 1);
  return value + (1 - value) * landing * landing;
}

/** |d fn / dx| by central difference. */
export function rate(fn: (x: number) => number, x: number, h = 0.012): number {
  const a = clamp01(x - h);
  const b = clamp01(x + h);
  return b > a ? Math.abs(fn(b) - fn(a)) / (b - a) : 0;
}

/** Scale a W×H frame needs, rotated by `deg`, to still cover the W×H viewport. */
export function coverScale(deg: number, width: number, height: number): number {
  const angle = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return Math.max((width * c + height * s) / width, (width * s + height * c) / height);
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A stable 0..1 value for an integer (frame-level flicker that renders identically). */
export function hash01(n: number): number {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function seeded(seed: number): () => number {
  return createSeededRandom(seed >>> 0);
}

// ── Colour ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean.slice(0, 6);
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha).toFixed(3)})`;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0")).join("")}`;
}

export function hueShift(hex: string, degrees: number): string {
  const [r, g, b] = hexToRgb(hex).map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let sat = 0;
  if (delta > 0) {
    sat = delta / (1 - Math.abs(2 * light - 1));
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
  }
  hue = (((hue + degrees) % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - chroma / 2;
  const [r1, g1, b1] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return rgbToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255);
}

/** Four on-brand colours for shape transitions: accent, second accent, a hue neighbour, ink. */
export function swatches(palette: Palette): [string, string, string, string] {
  const second = palette.accent2 ?? hueShift(palette.accent, 42);
  return [palette.accent, second, hueShift(palette.accent, -48), palette.ink];
}

export const BURN_COLORS = ["#ff2a00", "#ff7a00", "#ffb52e", "#e8114f", "#ff5a1f"] as const;

// ── CSS helpers ─────────────────────────────────────────────────────────────

export const px = (n: number) => `${n.toFixed(2)}px`;
export const pct = (n: number) => `${n.toFixed(3)}%`;
export const blurCss = (amount: number) => (amount > 0.05 ? `blur(${amount.toFixed(2)}px)` : undefined);
export function filters(...parts: Array<string | undefined | false>): string | undefined {
  const list = parts.filter(Boolean);
  return list.length ? list.join(" ") : undefined;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A clip-path that shows the union of rectangles (element-local px). */
export function rectsClip(rects: readonly Rect[]): string {
  const parts = rects
    .filter((rect) => rect.w > 0.01 && rect.h > 0.01)
    .map((rect) => `M${rect.x.toFixed(1)} ${rect.y.toFixed(1)}H${(rect.x + rect.w).toFixed(1)}V${(rect.y + rect.h).toFixed(1)}H${rect.x.toFixed(1)}Z`);
  return parts.length ? `path('${parts.join("")}')` : "inset(50% 50% 50% 50%)";
}

export function pointsPath(points: ReadonlyArray<readonly [number, number]>): string {
  return points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + "Z";
}

// ── SVG filter (one render of the clip, no copies) ──────────────────────────

export interface FilterSpec {
  /** Directional gaussian blur, px along x and y in the layer's own space (motion blur). */
  blur?: readonly [number, number];
  /** Turbulence displacement (warps, ripples, glitch slices). */
  displace?: {
    /** Turbulence base frequency per px; use n / width for n waves across. */
    freq: readonly [number, number];
    scale: number;
    octaves?: number;
    seed?: number;
    /** Only displace along one axis. */
    axis?: "x" | "y";
    /** Quantise into blocky steps (digital slices). */
    steps?: number;
  };
  /** Chromatic aberration: red and blue pulled apart by this many px. */
  rgb?: number;
  rgbAxis?: "x" | "y";
}

export function filterActive(spec: FilterSpec | undefined): spec is FilterSpec {
  if (!spec) return false;
  const blur = spec.blur && (spec.blur[0] > 0.1 || spec.blur[1] > 0.1);
  const displace = spec.displace && Math.abs(spec.displace.scale) > 0.2;
  const rgb = spec.rgb && Math.abs(spec.rgb) > 0.2;
  return Boolean(blur || displace || rgb);
}

export function SvgFilter({ id, spec }: { id: string; spec: FilterSpec }) {
  const steps: ReactNode[] = [];
  let input = "SourceGraphic";
  const displace = spec.displace;
  if (displace && Math.abs(displace.scale) > 0.2) {
    steps.push(
      <feTurbulence key="t" type="fractalNoise" baseFrequency={`${Math.max(0, displace.freq[0]).toFixed(5)} ${Math.max(0, displace.freq[1]).toFixed(5)}`} numOctaves={displace.octaves ?? 2} seed={displace.seed ?? 3} result="noise" />,
    );
    let map = "noise";
    if (displace.steps && displace.steps > 1) {
      const random = seeded((displace.seed ?? 3) * 31 + displace.steps);
      const table = Array.from({ length: displace.steps }, () => random().toFixed(3)).join(" ");
      steps.push(
        <feComponentTransfer key="q" in="noise" result="stepped">
          <feFuncR type="discrete" tableValues={table} />
          <feFuncG type="discrete" tableValues={table} />
        </feComponentTransfer>,
      );
      map = "stepped";
    }
    if (displace.axis) {
      const values = displace.axis === "x" ? "1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1" : "0 0 0 0 0.5  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1";
      steps.push(<feColorMatrix key="a" in={map} type="matrix" values={values} result="axis" />);
      map = "axis";
    }
    steps.push(<feDisplacementMap key="d" in={input} in2={map} scale={displace.scale.toFixed(2)} xChannelSelector="R" yChannelSelector="G" result="warped" />);
    input = "warped";
  }
  if (spec.rgb && Math.abs(spec.rgb) > 0.2) {
    const dx = spec.rgbAxis === "y" ? 0 : spec.rgb;
    const dy = spec.rgbAxis === "y" ? spec.rgb : 0;
    steps.push(
      <feColorMatrix key="r" in={input} type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />,
      <feOffset key="ro" in="red" dx={(-dx).toFixed(2)} dy={(-dy).toFixed(2)} result="red2" />,
      <feColorMatrix key="g" in={input} type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />,
      <feColorMatrix key="b" in={input} type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />,
      <feOffset key="bo" in="blue" dx={dx.toFixed(2)} dy={dy.toFixed(2)} result="blue2" />,
      <feBlend key="rg" in="red2" in2="green" mode="screen" result="rg" />,
      <feBlend key="rgb" in="rg" in2="blue2" mode="screen" result="split" />,
    );
    input = "split";
  }
  if (spec.blur && (spec.blur[0] > 0.1 || spec.blur[1] > 0.1)) {
    steps.push(<feGaussianBlur key="bl" in={input} stdDeviation={`${spec.blur[0].toFixed(2)} ${spec.blur[1].toFixed(2)}`} result="blurred" />);
  }
  return (
    <filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
      {steps}
    </filter>
  );
}

// ── Overlays ────────────────────────────────────────────────────────────────

const fill: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

/** Blurs whatever is behind it towards the frame edges (zoom blur), sharp in the middle. */
export function EdgeBlur({ amount, strength }: { amount: number; strength: number }) {
  if (strength <= 0.01 || amount <= 0.1) return null;
  const mask = "radial-gradient(ellipse 70% 70% at 50% 50%, transparent 30%, #000 85%)";
  return (
    <div
      style={{
        ...fill,
        backdropFilter: `blur(${amount.toFixed(1)}px)`,
        WebkitBackdropFilter: `blur(${amount.toFixed(1)}px)`,
        maskImage: mask,
        WebkitMaskImage: mask,
        opacity: clamp01(strength),
      }}
    />
  );
}

export function Flash({ opacity, color = "#ffffff" }: { opacity: number; color?: string }) {
  if (opacity <= 0.005) return null;
  return <div style={{ ...fill, background: color, opacity: clamp01(opacity) }} />;
}

/**
 * Film burn: soft blobs of hot colour drifting across, screened over the
 * picture, with a white-hot core at full intensity. One element, many
 * gradient layers, no blur filter. Belongs in a frame's `glow` (screen-blended).
 */
export function Burn({ intensity, t, seed, mode = "drift", width, height }: { intensity: number; t: number; seed: number; mode?: "drift" | "sides"; width: number; height: number }) {
  if (intensity <= 0.01) return null;
  const random = seeded(seed * 7 + 11);
  const layers: string[] = [];
  const size = Math.max(width, height);
  if (mode === "drift") {
    for (let index = 0; index < 6; index += 1) {
      const color = BURN_COLORS[index % BURN_COLORS.length] ?? "#ff8a00";
      const x = mix(-0.15 + random() * 0.5, 0.55 + random() * 0.6, t);
      const y = 0.15 + random() * 0.7 + (t - 0.5) * (random() - 0.5) * 0.6;
      const radius = (0.32 + random() * 0.38) * size;
      layers.push(`radial-gradient(circle ${px(radius)} at ${pct(x * 100)} ${pct(y * 100)}, ${rgba(color, 0.9)} 0%, ${rgba(color, 0.5)} 40%, ${rgba(color, 0)} 100%)`);
    }
  } else {
    const front = ease.in(seg(t, 0, 0.5)) * 0.5;
    for (const side of [0, 1] as const) {
      for (let index = 0; index < 4; index += 1) {
        const color = BURN_COLORS[(index + side * 2) % BURN_COLORS.length] ?? "#ff8a00";
        const x = side === 0 ? -0.3 + front * 1.6 : 1.3 - front * 1.6;
        const y = 0.12 + index * 0.26 + (random() - 0.5) * 0.12;
        const radius = (0.22 + random() * 0.18) * size;
        layers.push(`radial-gradient(circle ${px(radius)} at ${pct(x * 100)} ${pct(y * 100)}, ${rgba(color, 0.95)} 0%, ${rgba(color, 0.4)} 50%, ${rgba(color, 0)} 100%)`);
      }
    }
  }
  const core = seg(intensity, 0.82, 1);
  return (
    <>
      <div style={{ ...fill, backgroundImage: layers.join(", "), opacity: clamp01(intensity) * 0.88 }} />
      <Flash opacity={core * core * 0.75} color="#fff3e0" />
    </>
  );
}

export interface Disc {
  x: number;
  y: number;
  size: number;
  color: string;
  alpha: number;
}

/** Bokeh: soft discs with a faint rim. Belongs in a frame's `glow`. */
export function Bokeh({ discs }: { discs: readonly Disc[] }) {
  return (
    <div style={{ ...fill, overflow: "hidden" }}>
      {discs.map((disc, index) =>
        disc.alpha > 0.01 ? (
          <div
            key={index}
            style={{
              position: "absolute",
              left: disc.x - disc.size / 2,
              top: disc.y - disc.size / 2,
              width: disc.size,
              height: disc.size,
              borderRadius: "50%",
              background: `radial-gradient(circle closest-side, ${rgba(disc.color, disc.alpha * 0.55)} 0%, ${rgba(disc.color, disc.alpha * 0.7)} 78%, ${rgba(disc.color, disc.alpha)} 90%, ${rgba(disc.color, 0)} 100%)`,
            }}
          />
        ) : null,
      )}
    </div>
  );
}

/** TV static: coarse monochrome turbulence, a new seed every frame. */
export function Noise({ id, opacity, frame, width, height }: { id: string; opacity: number; frame: number; width: number; height: number }) {
  if (opacity <= 0.01) return null;
  const vbWidth = 360;
  const vbHeight = Math.max(1, Math.round((360 * height) / width));
  return (
    <svg style={{ ...fill, width: "100%", height: "100%", opacity: clamp01(opacity) }} viewBox={`0 0 ${vbWidth} ${vbHeight}`} preserveAspectRatio="none" aria-hidden>
      <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.72 0.9" numOctaves={1} seed={(frame % 9973) + 1} />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncR type="linear" slope={2.4} intercept={-0.7} />
          <feFuncG type="linear" slope={2.4} intercept={-0.7} />
          <feFuncB type="linear" slope={2.4} intercept={-0.7} />
          <feFuncA type="linear" slope={0} intercept={1} />
        </feComponentTransfer>
      </filter>
      <rect width={vbWidth} height={vbHeight} filter={`url(#${id})`} />
    </svg>
  );
}

export function Scanlines({ opacity, unit }: { opacity: number; unit: number }) {
  if (opacity <= 0.01) return null;
  const line = Math.max(1, 1.6 * unit);
  return <div style={{ ...fill, opacity: clamp01(opacity), backgroundImage: `repeating-linear-gradient(to bottom, rgba(0,0,0,0.42) 0, rgba(0,0,0,0.42) ${px(line)}, transparent ${px(line)}, transparent ${px(line * 2.6)})` }} />;
}

export function Shadowed({ rects, blur, opacity }: { rects: readonly Rect[]; blur: number; opacity: number }) {
  if (opacity <= 0.01) return null;
  return (
    <>
      {rects.map((rect, index) => (
        <div key={index} style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, boxShadow: `0 ${px(blur * 0.25)} ${px(blur)} rgba(0,0,0,${clamp01(opacity).toFixed(3)})`, pointerEvents: "none" }} />
      ))}
    </>
  );
}
