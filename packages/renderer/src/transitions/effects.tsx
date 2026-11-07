import React from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Palette, Transition, TransitionType } from "@crewcut/composition";
import { MOTION_RULES } from "@crewcut/motion";

import {
  BURN_COLORS,
  Bokeh,
  Burn,
  type Disc,
  EdgeBlur,
  type FilterSpec,
  Flash,
  Noise,
  type Rect,
  Scanlines,
  Shadowed,
  bell,
  blurCss,
  clamp01,
  coverScale,
  ease,
  filters,
  hash01,
  mix,
  pct,
  pointsPath,
  px,
  rate,
  rectsClip,
  rgba,
  seeded,
  seg,
  settle,
  smooth,
  swatches,
} from "./kit";

/**
 * Every transition as a pure function of progress. The stage draws the
 * outgoing clip (`exit`) and the incoming one (`enter`) once each — never
 * copies, so video layers keep playing — and applies what a frame returns:
 * styles, an SVG filter (motion blur, warps, colour split), which clip is on
 * top, and graphics between or above them.
 *
 * Most effects cut at the midpoint, at peak speed, under blur or a cover —
 * the editor's trick for making a cut read as one continuous move.
 */

export type Direction = Transition["direction"];

export interface TransitionContext {
  type: TransitionType;
  direction: Direction;
  /** Raw progress 0..1. */
  t: number;
  /** Progress through the transition's easing. */
  e: number;
  /** |de/dt| normalised to ~0..1 (peaks mid-move); drives motion blur. */
  speed: number;
  durationMs: number;
  width: number;
  height: number;
  /** 1 unit ≈ 1px at 1080 on the short side; scales every size. */
  unit: number;
  palette: Palette;
  seed: number;
  frame: number;
  fontFamily: string;
  /** Unique, url()-safe prefix for SVG ids. */
  id: string;
  /** What each clip actually draws (px): the whole frame for full shots, the element's box otherwise. */
  exitBox?: ContentBox;
  enterBox?: ContentBox;
  /**
   * The clips don't fill the frame (elements and text on an overlay track): there is no
   * picture to smear behind them, so effects drop zoom ghosts and edge blur.
   */
  transparent?: boolean;
}

export interface ContentBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Zoom-blurs the frame's edges, but only behind a full-frame shot: on an element it would blur the shot underneath. */
function edgeBlur(c: TransitionContext, amount: number, strength: number) {
  return c.transparent ? null : <EdgeBlur amount={amount} strength={strength} />;
}

export interface LayerSpec {
  style?: CSSProperties;
  filter?: FilterSpec;
  hidden?: boolean;
}

export interface TransitionFrame {
  exit: LayerSpec;
  enter: LayerSpec;
  /** Which clip draws on top (default: enter). */
  top?: "exit" | "enter";
  /** Drawn above the bottom clip, below the top one. */
  middle?: ReactNode;
  /** Drawn above both clips. */
  overlay?: ReactNode;
  /** Drawn above everything with screen blending: light, burns, bokeh. */
  glow?: ReactNode;
}

type Effect = (c: TransitionContext) => TransitionFrame;

const VEC: Record<Direction, readonly [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

const translate = (d: readonly [number, number], amount: number) => `translate(${pct(d[0] * amount)}, ${pct(d[1] * amount)})`;
const along = (d: readonly [number, number], amount: number): [number, number] => [Math.abs(d[0]) * amount, Math.abs(d[1]) * amount];
const spinSign = (c: TransitionContext) => (c.direction === "left" ? -1 : 1);
const halves = (c: TransitionContext) => ({ k: clamp01(c.e / 0.5), m: clamp01((c.e - 0.5) / 0.5), after: c.e >= 0.5 });
const halfDiagonal = (c: TransitionContext) => Math.hypot(c.width, c.height) / 2;

/** The visible clip on top, the other hidden — a cut at `after`. */
function cutAt(after: boolean, exit: LayerSpec, enter: LayerSpec, extra: Partial<TransitionFrame> = {}): TransitionFrame {
  return { exit: { ...exit, hidden: after || exit.hidden }, enter: { ...enter, hidden: !after || enter.hidden }, top: after ? "enter" : "exit", ...extra };
}

// ── Basic ───────────────────────────────────────────────────────────────────

const basic: Partial<Record<TransitionType, Effect>> = {
  cut: () => ({ exit: { hidden: true }, enter: {} }),
  crossfade: (c) => ({ exit: {}, enter: { style: { opacity: c.e } } }),
  "blur-crossfade": (c) => {
    const blur = MOTION_RULES.crossfadeBlurMaxPx * 0.75 * c.unit;
    return {
      enter: { style: { opacity: c.e, filter: blurCss((1 - c.e) * blur) } },
      exit: { style: { filter: blurCss(c.e * blur), opacity: 1 - c.e * 0.35 } },
    };
  },
  push: (c) => {
    const d = VEC[c.direction];
    const blur = along(d, c.speed * 26 * c.unit);
    return {
      exit: { style: { transform: translate(d, c.e * 100) }, filter: { blur } },
      enter: { style: { transform: translate(d, (c.e - 1) * 100) }, filter: { blur } },
    };
  },
  slide: (c) => {
    const d = VEC[c.direction];
    return {
      enter: { style: { transform: translate(d, (c.e - 1) * 100), boxShadow: `0 0 ${px(80 * c.unit)} rgba(0,0,0,0.35)` }, filter: { blur: along(d, c.speed * 14 * c.unit) } },
      exit: { style: { opacity: 1 - c.e * 0.4, transform: `scale(${1 - c.e * 0.04})` } },
    };
  },
  "zoom-through": (c) => ({
    enter: { style: { opacity: c.e, transform: `scale(${0.92 + 0.08 * c.e})` } },
    exit: { style: { opacity: 1 - c.e, transform: `scale(${1 + c.e * 0.5})`, filter: blurCss(c.speed * 6 * c.unit) } },
  }),
  wipe: (c) => {
    const d = VEC[c.direction];
    const inset = (1 - c.e) * 100;
    const clip = d[0] < 0 ? `inset(0 0 0 ${inset}%)` : d[0] > 0 ? `inset(0 ${inset}% 0 0)` : d[1] < 0 ? `inset(${inset}% 0 0 0)` : `inset(0 0 ${inset}% 0)`;
    return { enter: { style: { clipPath: clip } }, exit: {} };
  },
  "scale-fade": (c) => ({ enter: { style: { opacity: c.e, transform: `scale(${0.95 + 0.05 * c.e})` } }, exit: { style: { opacity: 1 - c.e } } }),
};

// ── Zoom ────────────────────────────────────────────────────────────────────

/** Feathers a layer's edges while it is smaller than the frame, so it melts into the smear behind it. */
function feather(amount: number): CSSProperties {
  if (amount <= 0.01) return {};
  const solid = mix(100, 38, Math.sqrt(clamp01(amount)));
  const mask = `radial-gradient(ellipse 72% 72% at 50% 50%, #000 ${solid.toFixed(1)}%, transparent 100%)`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

/** Feather amount for a layer at `scale` (0 at full size, 1 at `smallest`). */
const featherAt = (scale: number, smallest: number) => (scale >= 1 ? 0 : clamp01((1 - scale) / (1 - smallest)));

/** Continuous zoom (in or out) with the cut at peak speed, both halves on the same log-scale line. */
function zoomJump(c: TransitionContext, outward: boolean, peak = 1.55): TransitionFrame {
  const { k, m, after } = halves(c);
  const blur = c.speed * 9 * c.unit;
  const overlay = edgeBlur(c, 22 * c.unit, c.speed * 1.1);
  if (!outward) {
    // In: A grows; B arrives a little small with feathered edges and grows to fit while A's smear keeps zooming behind it.
    return {
      exit: { style: { transform: `scale(${Math.pow(peak, after ? 1 + m : k)})`, filter: blurCss(after ? blur * 1.8 + 4 * c.unit : blur) }, hidden: Boolean(after && c.transparent) },
      enter: { style: { transform: `scale(${Math.pow(peak, m - 1)})`, filter: blurCss(blur), ...feather(featherAt(Math.pow(peak, m - 1), 1 / peak)) }, hidden: !after },
      top: after ? "enter" : "exit",
      overlay,
    };
  }
  // Out: A shrinks (edges feathered) over B's blurred close-up; then B pulls back to fit.
  return {
    exit: { style: { transform: `scale(${Math.pow(peak, -k)})`, filter: blurCss(blur), ...feather(featherAt(Math.pow(peak, -k), 1 / peak)) }, hidden: after },
    enter: { style: { transform: `scale(${Math.pow(peak, after ? 1 - m : 2 - k)})`, filter: blurCss(after ? blur : blur * 1.8 + 4 * c.unit) }, hidden: Boolean(!after && c.transparent) },
    top: after ? "enter" : "exit",
    overlay,
  };
}

/** A cut at raw time `at`, the second half landing on a spring. */
function bounceZoom(c: TransitionContext, from: { a: number; b: number }, landing: number, at = 0.4): TransitionFrame {
  const k = seg(c.t, 0, at);
  const m = seg(c.t, at, 1);
  const after = c.t >= at;
  const springMs = c.durationMs * (1 - at);
  const scaleA = (x: number) => mix(1, from.a, ease.in(x));
  // Landing from above folds the undershoot into a second, smaller bounce, so the frame stays covered.
  const scaleB = (x: number) => {
    const value = mix(landing, 1, settle(x, springMs, 0.42, 0.55));
    return landing > 1 ? 1 + Math.abs(value - 1) : value;
  };
  const blurA = rate(scaleA, k) * 5 * c.unit;
  const blurB = Math.min(18, rate(scaleB, m) * 3.2) * c.unit;
  const under = from.a < 1 ? 1.15 : from.a;
  return {
    exit: { style: { transform: `scale(${after ? under : scaleA(k)})`, filter: blurCss(after ? 14 * c.unit : blurA), ...(after ? {} : feather(featherAt(scaleA(k), from.a))) }, hidden: Boolean(after && c.transparent) },
    enter: { style: { transform: `scale(${after ? scaleB(m) : landing})`, filter: blurCss(after ? blurB : 14 * c.unit), ...(after ? feather(featherAt(scaleB(m), landing)) : {}) }, hidden: !after && (from.a >= 1 || Boolean(c.transparent)) },
    top: after ? "enter" : "exit",
    overlay: edgeBlur(c, 18 * c.unit, after ? clamp01(blurB / (8 * c.unit)) : ease.in(k)),
  };
}

const zoom: Partial<Record<TransitionType, Effect>> = {
  "zoom-in": (c) => zoomJump(c, false),
  "zoom-out": (c) => zoomJump(c, true),
  "zoom-in-out": (c) => {
    const { k, m, after } = halves(c);
    const blur = c.speed * 7 * c.unit;
    const glow = `brightness(${(1 + 0.12 * bell(c.e)).toFixed(3)})`;
    return cutAt(
      after,
      { style: { transform: `scale(${1 + 0.15 * k})`, filter: filters(blurCss(blur), glow) } },
      { style: { transform: `scale(${1.38 - 0.38 * ease.out(m)})`, filter: filters(blurCss(blur), glow) } },
      { overlay: edgeBlur(c, 16 * c.unit, c.speed) },
    );
  },
  "zoom-bounce": (c) => bounceZoom(c, { a: 1.8, b: 0.55 }, 0.55),
  "zoom-out-bounce": (c) => bounceZoom(c, { a: 0.7, b: 1.5 }, 1.5),
  "bounce-zoom": (c) => {
    const appear = ease.out(seg(c.t, 0, 0.4));
    const scale = mix(0.9, 1, settle(c.t, c.durationMs, 0.45, 0.62));
    return {
      exit: { style: { transform: `scale(${1 + 0.06 * ease.inOut(c.t)})`, filter: `brightness(${(1 - 0.18 * c.t).toFixed(3)})` } },
      enter: { style: { opacity: appear, transform: `scale(${scale})`, filter: blurCss((1 - appear) * 6 * c.unit) } },
    };
  },
  "zoom-burn": (c) => {
    const { k, m, after } = halves(c);
    const heat = bell(c.t);
    const blur = c.speed * 8 * c.unit;
    const look = `brightness(${(1 + 0.7 * heat).toFixed(3)}) saturate(${(1 + 0.3 * heat).toFixed(3)})`;
    return cutAt(
      after,
      { style: { transform: `scale(${1 + 0.5 * k * k})`, filter: filters(blurCss(blur), look) } },
      { style: { transform: `scale(${1.32 - 0.32 * ease.out(m)})`, filter: filters(blurCss(blur), look) } },
      { glow: <Burn intensity={Math.pow(heat, 1.3)} t={c.t} seed={c.seed} width={c.width} height={c.height} /> },
    );
  },
  "zoom-spin": (c) => {
    const { k, m, after } = halves(c);
    const sign = spinSign(c);
    const peak = 1.8;
    const angleA = sign * 50 * (after ? 1 : k);
    const angleB = sign * 50 * (m - 1);
    const blur = c.speed * 12 * c.unit;
    return {
      exit: { style: { transform: `rotate(${angleA}deg) scale(${Math.max(after ? peak : Math.pow(peak, k), coverScale(angleA, c.width, c.height))})`, filter: blurCss(after ? blur * 1.6 : blur) }, hidden: Boolean(after && c.transparent) },
      enter: { style: { transform: `rotate(${angleB}deg) scale(${Math.pow(peak, m - 1)})`, filter: blurCss(blur), ...feather(Math.min(1, featherAt(Math.pow(peak, m - 1), 1 / peak) + Math.abs(angleB) / 60)) }, hidden: !after },
      top: after ? "enter" : "exit",
      overlay: edgeBlur(c, 20 * c.unit, c.speed),
    };
  },
  "zoom-distort": (c) => {
    const { k, m, after } = halves(c);
    const warp = bell(c.e);
    const filter: FilterSpec = { displace: { freq: [4 / c.width, 3 / c.height], scale: 80 * c.unit * warp, octaves: 2, seed: c.seed % 97 }, rgb: 5 * c.unit * warp };
    return cutAt(
      after,
      { style: { transform: `scale(${1 + 0.32 * k})`, filter: blurCss(c.speed * 4 * c.unit) }, filter },
      { style: { transform: `scale(${1.32 - 0.32 * ease.out(m)})`, filter: blurCss(c.speed * 4 * c.unit) }, filter },
    );
  },
  "countdown-zoom": (c) => {
    // Matched to the reference frame by frame: no tweening, five hard steps (frames at 30 fps in the
    // original: 1, 1, 1 | 1, 2). The last clip jumps closer three times (sharp, blurred, heavier), the
    // cut lands at peak blur, and the next clip steps back out twice before snapping sharp at rest.
    // The held steps are the tick; strung across cuts they count.
    const steps = [
      { clip: "exit", until: 1 / 6, scale: 1.4, blur: 0 },
      { clip: "exit", until: 2 / 6, scale: 1.9, blur: 10 },
      { clip: "exit", until: 3 / 6, scale: 2.3, blur: 16 },
      { clip: "enter", until: 4 / 6, scale: 1.35, blur: 16 },
      { clip: "enter", until: 1, scale: 1.08, blur: 8 },
    ] as const;
    const step = steps.find((entry) => c.t < entry.until) ?? steps[4];
    const style = { transform: `scale(${step.scale})`, filter: blurCss(step.blur * c.unit) };
    return cutAt(step.clip === "enter", { style }, { style });
  },
};

// ── Spin ────────────────────────────────────────────────────────────────────

function rotated(c: TransitionContext, angle: number, extra = 1, prefix = "") {
  return `${prefix}rotate(${angle.toFixed(3)}deg) scale(${(coverScale(angle, c.width, c.height) * extra).toFixed(4)})`;
}

const spin: Partial<Record<TransitionType, Effect>> = {
  spin: (c) => {
    const { after } = halves(c);
    const sign = spinSign(c);
    const angle = sign * 360 * (after ? c.e - 1 : c.e);
    const blur = c.speed * 12 * c.unit;
    const swell = 1 + 0.12 * bell(c.e);
    return cutAt(after, { style: { transform: rotated(c, angle, swell), filter: blurCss(blur) } }, { style: { transform: rotated(c, angle, swell), filter: blurCss(blur) } }, { overlay: edgeBlur(c, 18 * c.unit, c.speed) });
  },
  twist: (c) => {
    const { k, m, after } = halves(c);
    const sign = spinSign(c);
    const warp = bell(c.e);
    const filter: FilterSpec = { displace: { freq: [2.5 / c.width, 2.5 / c.height], scale: 90 * c.unit * warp, octaves: 1, seed: (c.seed % 89) + 1 } };
    const blur = blurCss(c.speed * 7 * c.unit);
    return cutAt(
      after,
      { style: { transform: rotated(c, sign * 55 * k, 1 + 0.2 * k), filter: blur }, filter },
      { style: { transform: rotated(c, sign * 55 * (m - 1), 1 + 0.2 * (1 - m)), filter: blur }, filter },
    );
  },
  "double-twist": (c) => {
    const { k, m, after } = halves(c);
    const sign = spinSign(c);
    const swell = 1 + 0.1 * bell(c.e);
    const blur = blurCss(c.speed * 10 * c.unit);
    // Clockwise into the cut, anticlockwise out of it: the reversal reads as a snap.
    return cutAt(after, { style: { transform: rotated(c, sign * 45 * k, swell), filter: blur } }, { style: { transform: rotated(c, sign * 45 * (1 - m), swell), filter: blur } });
  },
  "spin-twist": (c) => {
    const { k, m, after } = halves(c);
    const sign = spinSign(c);
    const depth = 1500 * c.unit;
    const blur = blurCss(c.speed * 5 * c.unit);
    const pose = (x: number) => `perspective(${px(depth)}) rotateY(${(sign * 38 * x).toFixed(2)}deg) ` + rotated(c, sign * 80 * x, 1 + 0.38 * Math.abs(x));
    return cutAt(after, { style: { transform: pose(k), filter: blur } }, { style: { transform: pose(m - 1), filter: blur } });
  },
  "spin-up": (c) => {
    const sign = spinSign(c);
    const tilt = sign * 14 * bell(c.e);
    const camera = `rotate(${tilt.toFixed(3)}deg) scale(${(coverScale(tilt, c.width, c.height) * (1 + 0.12 * bell(c.e))).toFixed(4)}) `;
    const warp = bell(c.e);
    const filter: FilterSpec = { blur: [0, c.speed * 26 * c.unit], displace: { freq: [5 / c.width, 0.6 / c.height], scale: 44 * c.unit * warp, axis: "x", seed: (c.seed % 83) + 2 } };
    return {
      exit: { style: { transform: `${camera}translateY(${pct(-c.e * 100)})` }, filter },
      enter: { style: { transform: `${camera}translateY(${pct((1 - c.e) * 100)})` }, filter },
    };
  },
  "spin-3d": (c) => {
    const { k, m, after } = halves(c);
    const sign = spinSign(c);
    const depth = 1300 * c.unit;
    const blur = blurCss(c.speed * 10 * c.unit);
    const pose = (x: number) => `perspective(${px(depth)}) translateY(${pct(-38 * x)}) rotateX(${(62 * x).toFixed(2)}deg) rotateZ(${(sign * 24 * x).toFixed(2)}deg) scale(${(1 + 0.22 * Math.abs(x)).toFixed(4)})`;
    return {
      exit: { style: { transform: pose(k), filter: filters(blur, `brightness(${(1 - 0.25 * k).toFixed(3)})`) } },
      enter: { style: { transform: pose(m - 1), filter: filters(after ? blur : blurCss(12 * c.unit), `brightness(${(0.75 + 0.25 * m).toFixed(3)})`) }, hidden: Boolean(!after && c.transparent) },
      top: after ? "enter" : "exit",
    };
  },
  "twist-burn": (c) => {
    const { k, m, after } = halves(c);
    const heat = bell(c.t);
    const look = filters(blurCss(c.speed * 8 * c.unit), `brightness(${(1 + 0.75 * heat).toFixed(3)})`);
    return cutAt(
      after,
      { style: { transform: rotated(c, 30 * k, 1 + 0.25 * k), filter: look } },
      { style: { transform: rotated(c, -30 * (1 - m), 1 + 0.25 * (1 - m)), filter: look } },
      { glow: <Burn intensity={Math.pow(heat, 1.15)} t={c.t} seed={c.seed + 5} width={c.width} height={c.height} /> },
    );
  },
};

// ── Motion ──────────────────────────────────────────────────────────────────

/** Rectangles revealing a frame from the side content enters, in `n` staggered bands. */
function bandRects(c: TransitionContext, d: readonly [number, number], progress: readonly number[], shift: readonly [number, number] = [0, 0]): Rect[] {
  const { width: W, height: H } = c;
  const n = progress.length;
  const pad = 2;
  return progress.map((p, index) => {
    if (d[0] !== 0) {
      const y = (index * H) / n - pad / 2;
      const h = H / n + pad;
      const w = W * p;
      const x = d[0] < 0 ? W - w : 0;
      return { x: x - shift[0], y: y - shift[1], w, h };
    }
    const x = (index * W) / n - pad / 2;
    const w = W / n + pad;
    const h = H * p;
    const y = d[1] < 0 ? H - h : 0;
    return { x: x - shift[0], y: y - shift[1], w, h };
  });
}

const motion: Partial<Record<TransitionType, Effect>> = {
  swipe: (c) => {
    const d = VEC[c.direction];
    const position = (x: number) => settle(x, c.durationMs, 0.66, 0.95);
    const p = position(c.t);
    const blur = along(d, Math.min(1, rate(position, c.t) / 4) * 30 * c.unit);
    // The bump: B overshoots a touch and is scaled just enough to keep the frame covered.
    const over = Math.max(0, p - 1);
    return {
      exit: { style: { transform: translate(d, p * 100) }, filter: { blur } },
      enter: { style: { transform: `${translate(d, (p - 1) * 100)} scale(${1 + 2.2 * over})` }, filter: { blur } },
    };
  },
  "zoom-swipe": (c) => {
    const d = VEC[c.direction];
    const camera = `scale(${(1 + 0.14 * bell(c.e)).toFixed(4)}) `;
    const blur = along(d, c.speed * 24 * c.unit);
    return {
      exit: { style: { transform: camera + translate(d, c.e * 100) }, filter: { blur } },
      enter: { style: { transform: camera + translate(d, (c.e - 1) * 100) }, filter: { blur } },
    };
  },
  "motion-scroll": (c) => {
    const d = VEC[c.direction];
    const warp = bell(c.e);
    const vertical = d[1] !== 0;
    const filter: FilterSpec = {
      blur: along(d, c.speed * 30 * c.unit),
      displace: { freq: vertical ? [0.6 / c.width, 6 / c.height] : [6 / c.width, 0.6 / c.height], scale: 46 * c.unit * warp, axis: vertical ? "x" : "y", seed: (c.seed % 79) + 3 },
    };
    const camera = `scale(${(1 + 0.05 * warp).toFixed(4)}) `;
    return {
      exit: { style: { transform: camera + translate(d, c.e * 100) }, filter },
      enter: { style: { transform: camera + translate(d, (c.e - 1) * 100) }, filter },
    };
  },
  "distort-slide": (c) => {
    const d = VEC[c.direction];
    const warp = bell(c.e);
    const vertical = d[1] !== 0;
    const skew = vertical ? `skewY(${(-d[1] * 7 * warp).toFixed(2)}deg)` : `skewX(${(-d[0] * 7 * warp).toFixed(2)}deg)`;
    const camera = `${skew} scale(${(1 + 0.16 * warp).toFixed(4)}) `;
    const filter: FilterSpec = {
      blur: along(d, c.speed * 20 * c.unit),
      displace: { freq: vertical ? [0.4 / c.width, 3 / c.height] : [3 / c.width, 0.4 / c.height], scale: 70 * c.unit * warp, axis: vertical ? "y" : "x", seed: (c.seed % 71) + 4 },
    };
    return {
      exit: { style: { transform: camera + translate(d, c.e * 100) }, filter },
      enter: { style: { transform: camera + translate(d, (c.e - 1) * 100) }, filter },
    };
  },
  "quick-distort": (c) => {
    const d = VEC[c.direction];
    const vertical = d[1] !== 0;
    const filter: FilterSpec = {
      blur: along(d, c.speed * 36 * c.unit),
      rgb: c.speed * 16 * c.unit,
      rgbAxis: vertical ? "y" : "x",
      displace: { freq: vertical ? [14 / c.width, 0.3 / c.height] : [0.3 / c.width, 14 / c.height], scale: 34 * c.unit * c.speed, axis: vertical ? "y" : "x", steps: 6, seed: (c.seed % 67) + 5 },
    };
    return {
      exit: { style: { transform: translate(d, c.e * 100) }, filter },
      enter: { style: { transform: translate(d, (c.e - 1) * 100) }, filter },
    };
  },
  "bounce-in": (c) => {
    const d = VEC[c.direction];
    const position = (x: number) => settle(x, c.durationMs, 0.55, 0.92);
    const p = position(c.t);
    const settled = Math.min(1, p);
    const over = Math.max(0, p - 1);
    return {
      exit: { style: { transform: `scale(${1 - 0.06 * settled})`, filter: `brightness(${(1 - 0.35 * settled).toFixed(3)})` } },
      enter: { style: { transform: `${translate(d, (p - 1) * 100)} scale(${1 + 2.2 * over})`, boxShadow: `0 0 ${px(70 * c.unit)} rgba(0,0,0,0.4)` }, filter: { blur: along(d, Math.min(1, rate(position, c.t) / 4) * 22 * c.unit) } },
    };
  },
  fracture: (c) => {
    const d = VEC[c.direction];
    const bands = [0.08, 0, 0.16].map((delay) => ease.inOut(seg(c.t, delay, delay + 0.84)));
    const lead = bands[1] ?? 0;
    const parallax = 0.25;
    const shift: [number, number] = [d[0] * (lead - 1) * parallax * c.width, d[1] * (lead - 1) * parallax * c.height];
    const blur = along(d, c.speed * 26 * c.unit);
    return {
      exit: { style: { transform: translate(d, c.e * 35), filter: `brightness(${(1 - 0.3 * c.e).toFixed(3)})` }, filter: { blur } },
      enter: { style: { transform: `translate(${px(shift[0])}, ${px(shift[1])})`, clipPath: rectsClip(bandRects(c, d, bands, shift)) }, filter: { blur, rgb: c.speed * 6 * c.unit, rgbAxis: d[1] !== 0 ? "y" : "x" } },
    };
  },
  "split-bounce": (c) => {
    const fromTop = c.direction !== "up";
    const columns = 4;
    const segment = 0.64;
    const progress = Array.from({ length: columns }, (_, index) => settle(seg(c.t, index * 0.09, index * 0.09 + segment), c.durationMs * segment, 0.5, 0.72));
    const colWidth = c.width / columns;
    const rects = progress.map((p, index) => ({
      x: index * colWidth - 1,
      y: fromTop ? c.height * (p - 1) : c.height * (1 - p),
      w: colWidth + 2,
      h: c.height,
    }));
    const covered = progress.reduce((sum, p) => sum + Math.min(1, p), 0) / columns;
    return {
      exit: { style: { filter: `brightness(${(1 - 0.45 * covered).toFixed(3)})`, transform: `scale(${1 - 0.04 * covered})` } },
      enter: { style: { clipPath: rectsClip(rects) } },
      middle: <Shadowed rects={rects} blur={40 * c.unit} opacity={0.5 * (1 - seg(c.t, 0.85, 1))} />,
    };
  },
  "frame-split": (c) => {
    const delays = [0.1, 0, 0.2];
    const progress = delays.map((delay) => ease.inOut(seg(c.t, delay, delay + 0.8)));
    const strip = c.width / 3;
    const rects = progress.map((p, index) => ({
      x: index * strip - 1,
      // Outer panels drop from the top, the middle one rises from the bottom.
      y: index === 1 ? c.height * (1 - p) : c.height * (p - 1),
      w: strip + 2,
      h: c.height,
    }));
    return {
      exit: { style: { transform: `scale(${1 - 0.06 * c.e})`, filter: `brightness(${(1 - 0.4 * c.e).toFixed(3)})` } },
      enter: { style: { clipPath: rectsClip(rects) }, filter: { blur: [0, c.speed * 18 * c.unit] } },
      middle: <Shadowed rects={rects} blur={36 * c.unit} opacity={0.5 * (1 - seg(c.t, 0.85, 1))} />,
    };
  },
  "step-scroll": (c) => {
    // Matched frame by frame to a reference recording (measured from the buttons' edges, which
    // scale with their card): a vertical stack of cards scrolls by one card on one critically
    // damped spring (response ~0.4 s, no overshoot, no blur) that drives position AND scale
    // together. Cards above the active one sit at 0.85× and ~55% opacity, so a card moving up into
    // that stack shrinks smoothly as it goes, and in "back" the card returning from it grows the
    // same way. Cards below keep their size and come in faint. Scale anchors at the card's bottom
    // edge so the gap to the next card holds. The leaving clip fades out over the last stretch
    // because it ends with the transition.
    const full = { top: 0, bottom: c.height };
    const a = c.exitBox ?? full;
    const b = c.enterBox ?? full;
    const gap = 0.06 * c.height;
    const up = c.direction !== "down";
    // Up: B waits below A and A ends above B's resting place. Down mirrors it.
    const enterFrom = up ? a.bottom + gap - b.top : a.top - gap - b.bottom;
    const exitTo = up ? b.top - gap - a.bottom : b.bottom + gap - a.top;
    const seconds = Math.max(0.05, c.durationMs / 1000);
    const p = settle(c.t, c.durationMs, 1, Math.min(1.2, 0.4 / seconds));
    const stacked = 0.85;
    const dimAbove = 0.55;
    const dimBelow = 0.25;
    const leave = 1 - smooth(0.7, 1, c.t);
    const exitScale = up ? mix(1, stacked, p) : 1;
    const enterScale = up ? 1 : mix(stacked, 1, p);
    const exitOpacity = (up ? mix(1, dimAbove, p) : mix(1, dimBelow, p)) * leave;
    const enterOpacity = up ? mix(dimBelow, 1, p) : mix(dimAbove, 1, p);
    return {
      exit: {
        style: {
          transform: `translateY(${px(exitTo * p)}) scale(${exitScale.toFixed(4)})`,
          transformOrigin: `50% ${px(a.bottom)}`,
          opacity: exitOpacity,
        },
      },
      enter: {
        style: {
          transform: `translateY(${px(enterFrom * (1 - p))}) scale(${enterScale.toFixed(4)})`,
          transformOrigin: `50% ${px(b.bottom)}`,
          opacity: enterOpacity,
        },
      },
    };
  },


  "falling-boxes": (c) => {
    const portrait = c.height > c.width;
    const cols = portrait ? 4 : 6;
    const rows = Math.max(3, Math.round((cols * c.height) / c.width));
    const tileW = c.width / cols;
    const tileH = c.height / rows;
    const segment = 0.5;
    const rects: Rect[] = [];
    let landed = 0;
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let col = 0; col < cols; col += 1) {
        // Bottom rows land first, like boxes stacking; a little sideways ripple.
        const delay = ((rows - 1 - row) / Math.max(1, rows - 1)) * 0.36 + (hash01(row * 31 + col + c.seed) * 0.1 + (col / cols) * 0.04);
        const local = seg(c.t, delay, delay + segment);
        if (local <= 0) continue;
        const p = settle(local, c.durationMs * segment, 0.55, 0.7);
        const gap = (1 - Math.min(1, p)) * 0.12 * tileW;
        landed += Math.min(1, p);
        rects.push({ x: col * tileW + gap / 2 - 0.5, y: row * tileH + (p - 1) * tileH * 1.6 + gap / 2 - 0.5, w: tileW - gap + 1, h: tileH - gap + 1 });
      }
    }
    const covered = landed / (cols * rows);
    return {
      exit: { style: { filter: `brightness(${(1 - 0.45 * covered).toFixed(3)})` } },
      enter: { style: { clipPath: rectsClip(rects) } },
      middle: <Shadowed rects={rects} blur={24 * c.unit} opacity={0.45 * (1 - seg(c.t, 0.8, 1))} />,
    };
  },
};

// ── Glitch ──────────────────────────────────────────────────────────────────

const glitch: Partial<Record<TransitionType, Effect>> = {
  static: (c) => {
    const after = c.t >= 0.5;
    const amount = Math.pow(bell(c.t), 2.2);
    const flicker = 1 + (hash01(c.frame + c.seed) - 0.5) * 0.5 * amount;
    const filter: FilterSpec = { rgb: 9 * c.unit * amount, displace: { freq: [0, 18 / c.height], scale: 34 * c.unit * amount * amount, axis: "x", steps: 5, seed: (c.frame % 50) + 1 } };
    const look = `brightness(${flicker.toFixed(3)}) contrast(${(1 + 0.25 * amount).toFixed(3)})`;
    return cutAt(after, { style: { filter: look }, filter }, { style: { filter: look }, filter }, { overlay: <Noise id={`${c.id}-noise`} opacity={0.88 * amount} frame={c.frame} width={c.width} height={c.height} /> });
  },
  "digital-static": (c) => {
    const amount = bell(c.t);
    const roll = hash01(c.frame * 7 + c.seed);
    // Frames flick between the two clips through the middle, weighted towards B as it goes.
    const after = c.t >= 0.68 || (c.t > 0.32 && roll < seg(c.t, 0.32, 0.68));
    const jitter = (hash01(c.frame * 13 + 3) - 0.5) * 44 * c.unit * amount;
    const filter: FilterSpec = { rgb: 22 * c.unit * amount, displace: { freq: [0, 12 / c.height], scale: 150 * c.unit * amount, axis: "x", steps: 5, seed: (c.frame % 61) + 1 } };
    const random = seeded(c.frame * 17 + c.seed);
    const tears = amount > 0.25 ? Array.from({ length: 3 }, () => ({ y: random() * c.height, h: (0.02 + random() * 0.07) * c.height, color: [c.palette.accent, "#00e5ff", "#ff2e88"][Math.floor(random() * 3)] ?? "#00e5ff" })) : [];
    return cutAt(
      after,
      { style: { transform: `translateX(${px(jitter)})` }, filter },
      { style: { transform: `translateX(${px(jitter)})` }, filter },
      {
        overlay: <Noise id={`${c.id}-noise`} opacity={0.42 * amount} frame={c.frame} width={c.width} height={c.height} />,
        glow: tears.map((tear, index) => <div key={index} style={{ position: "absolute", left: 0, right: 0, top: tear.y, height: tear.h, background: rgba(tear.color, 0.38 * amount) }} />),
      },
    );
  },
  "retro-interference": (c) => {
    const after = c.t >= 0.5;
    const amount = bell(c.t);
    const look = `brightness(${(1 - 0.5 * amount).toFixed(3)}) contrast(${(1 + 0.3 * amount).toFixed(3)}) saturate(${(1 - 0.6 * amount).toFixed(3)}) sepia(${(0.25 * amount).toFixed(3)})`;
    const filter: FilterSpec = { displace: { freq: [0, 3 / c.height], scale: 46 * c.unit * amount, axis: "x", octaves: 1, seed: (c.frame % 40) + 1 }, rgb: 4 * c.unit * amount };
    const roll = (hash01(c.frame + 99) - 0.5) * 18 * c.unit * amount;
    const barY = c.height * (1.15 - 1.4 * c.t);
    const bar = 0.14 * c.height;
    return cutAt(
      after,
      { style: { filter: look, transform: `translateY(${px(roll)})` }, filter },
      { style: { filter: look, transform: `translateY(${px(roll)})` }, filter },
      {
        overlay: (
          <>
            <Scanlines opacity={0.9 * amount} unit={c.unit} />
            <Noise id={`${c.id}-noise`} opacity={0.3 * amount} frame={c.frame} width={c.width} height={c.height} />
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.75) 100%)", opacity: amount }} />
          </>
        ),
        glow: <div style={{ position: "absolute", left: 0, right: 0, top: barY - bar / 2, height: bar, background: "linear-gradient(to bottom, transparent, rgba(255,255,255,0.22) 45%, rgba(255,255,255,0.32) 52%, transparent)", opacity: amount }} />,
      },
    );
  },
  "triangle-distort": (c) => {
    const sign = spinSign(c);
    const grow = ease.cubic(c.t);
    const radius = Math.max(1, halfDiagonal(c) * 2.15 * grow);
    const spinAngle = sign * -40 * (1 - grow);
    const cx = c.width / 2;
    const cy = c.height / 2;
    const triangle = (r: number) =>
      [0, 1, 2].map((corner) => {
        const angle = ((spinAngle + corner * 120) * Math.PI) / 180;
        return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)] as const;
      });
    const settleIn = 1 - grow;
    return {
      exit: { style: { transform: `scale(${1 + 0.1 * grow})`, filter: filters(blurCss(grow * 8 * c.unit), `brightness(${(1 - 0.3 * grow).toFixed(3)})`) } },
      enter: {
        style: { clipPath: `path('${pointsPath(triangle(radius))}')` },
        filter: { displace: { freq: [3 / c.width, 3 / c.height], scale: 70 * c.unit * settleIn, octaves: 2, seed: (c.seed % 53) + 6 }, rgb: 5 * c.unit * settleIn },
      },
      overlay: (
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.85 * bell(c.t), pointerEvents: "none" }} viewBox={`0 0 ${c.width} ${c.height}`} aria-hidden>
          <path d={pointsPath(triangle(radius * 1.04))} fill="none" stroke="#ffffff" strokeWidth={3 * c.unit} />
        </svg>
      ),
    };
  },
};

// ── Light ───────────────────────────────────────────────────────────────────

function bokehDiscs(c: TransitionContext, options: { count: number; size: [number, number]; alpha: number; colors: readonly string[]; place: (index: number, random: () => number) => [number, number] }): Disc[] {
  const random = seeded(c.seed * 13 + options.count);
  const short = Math.min(c.width, c.height);
  return Array.from({ length: options.count }, (_, index) => {
    const [x, y] = options.place(index, random);
    return {
      x,
      y,
      size: mix(options.size[0], options.size[1], random()) * short,
      color: options.colors[index % options.colors.length] ?? "#ffffff",
      alpha: options.alpha * (0.55 + 0.45 * random()),
    };
  });
}

const light: Partial<Record<TransitionType, Effect>> = {
  "film-burn": (c) => {
    const after = c.t >= 0.5;
    const heat = Math.pow(bell(c.t), 1.1) * (0.93 + 0.07 * hash01(c.frame + c.seed));
    const look = `brightness(${(1 + 0.35 * heat).toFixed(3)}) saturate(${(1 + 0.5 * heat).toFixed(3)}) contrast(${(1 + 0.1 * heat).toFixed(3)})`;
    return cutAt(after, { style: { filter: look } }, { style: { filter: look } }, { glow: <Burn intensity={heat} t={c.t} seed={c.seed} width={c.width} height={c.height} /> });
  },
  "swipe-burn": (c) => {
    const after = c.t >= 0.5;
    const meet = Math.pow(bell(c.t), 2);
    const filter: FilterSpec = { displace: { freq: [3 / c.width, 2 / c.height], scale: 90 * c.unit * meet, octaves: 2, seed: (c.seed % 47) + 7 } };
    const look = `brightness(${(1 + 0.4 * bell(c.t)).toFixed(3)}) saturate(${(1 + 0.3 * bell(c.t)).toFixed(3)})`;
    const flare = Math.pow(seg(c.t, 0.4, 0.5) * (1 - seg(c.t, 0.5, 0.7)), 1.5);
    return cutAt(
      after,
      { style: { filter: look }, filter },
      { style: { filter: look }, filter },
      {
        glow: (
          <>
            <Burn intensity={Math.pow(bell(c.t), 1.2) * 0.9} t={c.t} seed={c.seed + 3} mode="sides" width={c.width} height={c.height} />
            <Flash opacity={flare * 0.4} color="#fff3df" />
          </>
        ),
      },
    );
  },
  "bokeh-twirl": (c) => {
    const sign = spinSign(c);
    const focus = bell(c.t);
    const tilt = sign * 6 * focus;
    const hd = halfDiagonal(c);
    const discs = bokehDiscs(c, {
      count: 15,
      size: [0.06, 0.17],
      alpha: 0.85 * Math.pow(focus, 0.8),
      colors: [c.palette.accent, "#ffffff", BURN_COLORS[2], c.palette.accent2 ?? BURN_COLORS[1]],
      place: (index, random) => {
        const radius = (0.12 + random() * 0.55) * hd;
        const angle = random() * Math.PI * 2 + sign * c.t * Math.PI * 1.6 * (0.6 + (0.4 * radius) / hd);
        return [c.width / 2 + Math.cos(angle) * radius, c.height / 2 + Math.sin(angle) * radius * 0.75];
      },
    });
    const look = filters(blurCss(16 * c.unit * focus), `brightness(${(1 + 0.15 * focus).toFixed(3)})`);
    const transform = rotated(c, tilt, 1 + 0.06 * focus);
    return {
      exit: { style: { transform, filter: look } },
      enter: { style: { transform, filter: look, opacity: smooth(0.35, 0.65, c.t) } },
      glow: <Bokeh discs={discs} />,
    };
  },
  "bokeh-subtle": (c) => {
    const focus = bell(c.t);
    const discs = bokehDiscs(c, {
      count: 9,
      size: [0.05, 0.12],
      alpha: 0.38 * focus,
      colors: ["#ffffff", c.palette.accent, "#ffe7c2"],
      place: (_, random) => [random() * c.width, (random() * 1.1 - 0.05) * c.height - c.t * 0.22 * c.height],
    });
    return {
      exit: { style: { filter: blurCss(7 * c.unit * focus) } },
      enter: { style: { filter: blurCss(7 * c.unit * focus), opacity: smooth(0.25, 0.75, c.t) } },
      glow: <Bokeh discs={discs} />,
    };
  },
  "bokeh-bright": (c) => {
    const focus = bell(c.t);
    const discs = bokehDiscs(c, {
      count: 18,
      size: [0.07, 0.2],
      alpha: 0.9 * Math.pow(focus, 0.7),
      colors: ["#ffffff", "#fff1d6", BURN_COLORS[2], c.palette.accent],
      place: (_, random) => {
        const x = random() * c.width;
        const y = random() * c.height;
        return [x + (random() - 0.5) * 0.2 * c.width * c.t, y + (random() - 0.5) * 0.15 * c.height * c.t];
      },
    });
    const look = filters(blurCss(12 * c.unit * focus), `brightness(${(1 + 0.9 * focus).toFixed(3)})`);
    return {
      exit: { style: { filter: look } },
      enter: { style: { filter: look, opacity: smooth(0.35, 0.65, c.t) } },
      glow: (
        <>
          <Bokeh discs={discs} />
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, rgba(255,250,240,0.9), rgba(255,250,240,0) 70%)", opacity: 0.55 * focus * focus }} />
        </>
      ),
    };
  },
};

// ── Shapes ──────────────────────────────────────────────────────────────────

/** A liquid region swept along direction `d`: everything behind a wavy front at progress f. */
function liquidRegion(c: TransitionContext, d: readonly [number, number], f: number, phase: number): string {
  // Start-side corners, then the wavy front from one side to the other.
  const vertical = d[1] !== 0;
  const length = vertical ? c.height : c.width;
  const cross = vertical ? c.width : c.height;
  const amp = 0.11 * length;
  const live = 0.35 + 0.65 * bell(f);
  const front = mix(-amp * 1.9, length + amp * 1.9, f);
  const map = (s: number, k: number): [number, number] => (!vertical ? [d[0] > 0 ? s : length - s, k] : [k, d[1] > 0 ? s : length - s]);
  const points: Array<[number, number]> = [map(-amp * 3, -2)];
  const samples = 72;
  for (let index = 0; index <= samples; index += 1) {
    const u = index / samples;
    const k = u * (cross + 4) - 2;
    const wave = 0.55 * Math.sin(Math.PI * 2 * u * 1.25 + phase + f * 5) + 0.28 * Math.sin(Math.PI * 2 * u * 3.1 + phase * 1.7 - f * 3);
    const drips = 0.45 * Math.exp(-(((u - 0.3) / 0.05) ** 2)) + 0.32 * Math.exp(-(((u - 0.72) / 0.04) ** 2));
    points.push(map(front + amp * live * (wave + drips), k));
  }
  points.push(map(-amp * 3, cross + 2));
  return pointsPath(points);
}

function blobPath(cx: number, cy: number, radius: number, amp: number, phase: number, from = 0, to = Math.PI * 2): string {
  const points: Array<[number, number]> = [[cx, cy]];
  const samples = 80;
  for (let index = 0; index <= samples; index += 1) {
    const angle = from + ((to - from) * index) / samples;
    const r = Math.max(0, radius + amp * (0.5 * Math.sin(6 * angle + phase) + 0.3 * Math.sin(11 * angle - phase * 1.3) + 0.2 * Math.sin(3 * angle + phase * 0.5)));
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return pointsPath(points);
}

const svgFill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" };

const shapes: Partial<Record<TransitionType, Effect>> = {
  "liquid-swipe": (c) => {
    const d = VEC[c.direction];
    const colors = swatches(c.palette);
    const phase = (c.seed % 628) / 100;
    const layers = [0, 1].map((index) => ({ color: colors[index] ?? "#ff5b2e", f: ease.cubic(seg(c.t, index * 0.11, index * 0.11 + 0.6)) }));
    const reveal = ease.cubic(seg(c.t, 0.3, 0.97));
    return {
      exit: {},
      enter: { style: { clipPath: `path('${liquidRegion(c, d, reveal, phase + 2)}')` } },
      middle: (
        <svg style={svgFill} viewBox={`0 0 ${c.width} ${c.height}`} aria-hidden>
          {layers.map((layer, index) => (layer.f > 0 ? <path key={index} d={liquidRegion(c, d, layer.f, phase + index)} fill={layer.color} /> : null))}
        </svg>
      ),
    };
  },
  "liquid-splash": (c) => {
    const colors = swatches(c.palette);
    const cx = c.width * 1.03;
    const cy = c.height * 1.03;
    const reach = Math.hypot(c.width, c.height) * 1.12;
    const amp = 0.07 * Math.min(c.width, c.height);
    const phase = (c.seed % 628) / 100;
    const from = Math.PI * 0.92;
    const to = Math.PI * 1.58;
    const radius = (f: number) => f * (reach + amp * 2);
    const layers = [0, 1].map((index) => ({ color: colors[index] ?? "#ff5b2e", f: ease.cubic(seg(c.t, index * 0.12, index * 0.12 + 0.6)) }));
    const reveal = ease.cubic(seg(c.t, 0.34, 1));
    const lead = layers[0]?.f ?? 0;
    const random = seeded(c.seed * 3 + 1);
    const drops = Array.from({ length: 8 }, () => ({ angle: mix(from + 0.1, to - 0.1, random()), ahead: 0.05 + random() * 0.12, size: (0.18 + random() * 0.3) * amp }));
    return {
      exit: {},
      enter: { style: { clipPath: `path('${blobPath(cx, cy, radius(reveal), amp * (0.4 + 0.6 * bell(reveal)), phase + c.t * 3 + 2, from, to)}')` } },
      middle: (
        <svg style={svgFill} viewBox={`0 0 ${c.width} ${c.height}`} aria-hidden>
          {layers.map((layer, index) => (layer.f > 0 ? <path key={index} d={blobPath(cx, cy, radius(layer.f), amp * (0.4 + 0.6 * bell(layer.f)), phase + index + c.t * 3, from, to)} fill={layer.color} /> : null))}
          {lead > 0.04 && lead < 0.9
            ? drops.map((drop, index) => {
                const r = radius(lead) * (1 + drop.ahead) + amp;
                return <circle key={index} cx={cx + Math.cos(drop.angle) * r} cy={cy + Math.sin(drop.angle) * r} r={drop.size * (1 - seg(lead, 0.6, 0.9))} fill={colors[0]} />;
              })
            : null}
        </svg>
      ),
    };
  },
  "diagonal-stripes": (c) => {
    const colors = swatches(c.palette);
    const after = c.t >= 0.5;
    const angle = -32;
    const rad = (angle * Math.PI) / 180;
    const half = (c.width * Math.abs(Math.sin(rad)) + c.height * Math.abs(Math.cos(rad))) / 2 + 4;
    const long = Math.hypot(c.width, c.height) + 40;
    const bands: Array<{ color: string; a: number; b: number }> = [];
    for (let index = 0; index < 4; index += 1) {
      const cover = ease.cubic(seg(c.t, index * 0.05, index * 0.05 + 0.34));
      const retreat = ease.cubic(seg(c.t, 0.51 + (3 - index) * 0.05, 0.51 + (3 - index) * 0.05 + 0.34));
      const color = colors[3 - index] ?? "#ff5b2e";
      // Two bands per colour, from opposite edges, meeting (and vanishing) on the centre line.
      bands.push({ color, a: -half + retreat * half, b: -half + cover * half + 1 });
      bands.push({ color, a: half - cover * half - 1, b: half - retreat * half });
    }
    const cx = c.width / 2;
    const cy = c.height / 2;
    return cutAt(
      after,
      {},
      {},
      {
        overlay: (
          <svg style={svgFill} viewBox={`0 0 ${c.width} ${c.height}`} aria-hidden>
            <g transform={`rotate(${angle} ${cx} ${cy})`}>
              {bands.map((band, index) => (band.b - band.a > 0.5 ? <rect key={index} x={cx - long / 2} y={cy + band.a} width={long} height={band.b - band.a} fill={band.color} /> : null))}
            </g>
          </svg>
        ),
      },
    );
  },
  circles: (c) => {
    const colors = swatches(c.palette);
    const reach = halfDiagonal(c) + 2;
    const radius = (index: number) => reach * ease.cubic(seg(c.t, index * 0.14, index * 0.14 + 0.58));
    const shadow = `0 0 ${px(40 * c.unit)} rgba(0,0,0,0.28)`;
    return {
      exit: {},
      enter: { style: { clipPath: `circle(${px(radius(3))} at 50% 50%)` } },
      middle: (
        <>
          {[0, 1, 2].map((index) => {
            const r = radius(index);
            return r > 0.5 ? <div key={index} style={{ position: "absolute", left: c.width / 2 - r, top: c.height / 2 - r, width: r * 2, height: r * 2, borderRadius: "50%", background: colors[index], boxShadow: shadow }} /> : null;
          })}
        </>
      ),
    };
  },
  tubes: (c) => {
    const colors = swatches(c.palette);
    const angle = -30;
    const rad = (angle * Math.PI) / 180;
    const alongHalf = (c.width * Math.abs(Math.cos(rad)) + c.height * Math.abs(Math.sin(rad))) / 2;
    const crossHalf = (c.width * Math.abs(Math.sin(rad)) + c.height * Math.abs(Math.cos(rad))) / 2;
    const thickness = (crossHalf * 2) / 4 + 2;
    const length = alongHalf * 4;
    const cut = 0.485;
    const after = c.t >= cut;
    const cx = c.width / 2;
    const cy = c.height / 2;
    const tubes = [0, 1, 2, 3].map((index) => {
      const f = ease.soft(seg(c.t, index * 0.03, index * 0.03 + 0.88));
      const travel = mix(-(alongHalf + length / 2), alongHalf + length / 2, f) * (index % 2 === 0 ? 1 : -1);
      return { color: colors[index] ?? "#ff5b2e", center: travel, y: -crossHalf + index * (thickness - 2 / 3) };
    });
    return cutAt(
      after,
      {},
      {},
      {
        overlay: (
          <svg style={svgFill} viewBox={`0 0 ${c.width} ${c.height}`} aria-hidden>
            <g transform={`rotate(${angle} ${cx} ${cy})`}>
              {tubes.map((tube, index) => (
                <g key={index}>
                  <rect x={cx + tube.center - length / 2} y={cy + tube.y} width={length} height={thickness} rx={thickness / 2} fill={tube.color} />
                  <rect x={cx + tube.center - length / 2 + thickness * 0.5} y={cy + tube.y + thickness * 0.18} width={length - thickness} height={thickness * 0.12} rx={thickness * 0.06} fill="#ffffff" opacity={0.22} />
                </g>
              ))}
            </g>
          </svg>
        ),
      },
    );
  },
  "color-orbs": (c) => {
    const after = c.t >= 0.5;
    const colors = [...swatches(c.palette).slice(0, 3), "#ffffff", BURN_COLORS[2]];
    const random = seeded(c.seed * 5 + 2);
    const hd = halfDiagonal(c);
    const pull = ease.in(seg(c.t, 0, 0.52));
    const visible = seg(c.t, 0, 0.1) * (1 - seg(c.t, 0.5, 0.66));
    const bloom = Math.pow(bell(seg(c.t, 0.4, 0.64)), 2);
    const orbs = Array.from({ length: 7 }, (_, index) => {
      const angle = (index / 7) * Math.PI * 2 + (random() - 0.5) * 0.6;
      const start = hd * (0.5 + random() * 0.3);
      const radius = start * (1 - pull);
      const size = Math.min(c.width, c.height) * (0.34 + random() * 0.3) * (1 + 0.4 * pull);
      return { x: c.width / 2 + Math.cos(angle) * radius, y: c.height / 2 + Math.sin(angle) * radius * 0.8, size, color: colors[index % colors.length] ?? "#ffffff" };
    });
    const look = `brightness(${(1 + 0.6 * bloom).toFixed(3)}) saturate(${(1 + 0.3 * bloom).toFixed(3)})`;
    return cutAt(
      after,
      { style: { filter: look, transform: `scale(${1 + 0.05 * pull})` } },
      { style: { filter: look, transform: `scale(${1.08 - 0.08 * ease.out(seg(c.t, 0.5, 1))})` } },
      {
        glow: (
          <>
            <div style={{ position: "absolute", inset: 0, opacity: visible, pointerEvents: "none" }}>
              {orbs.map((orb, index) => (
                <div key={index} style={{ position: "absolute", left: orb.x - orb.size / 2, top: orb.y - orb.size / 2, width: orb.size, height: orb.size, borderRadius: "50%", background: `radial-gradient(circle closest-side, ${rgba(orb.color, 0.95)}, ${rgba(orb.color, 0.4)} 55%, ${rgba(orb.color, 0)})` }} />
              ))}
            </div>
            <Flash opacity={bloom * 0.72} color="#fffaf2" />
          </>
        ),
      },
    );
  },
  confetti: (c) => {
    const colors = [...swatches(c.palette).slice(0, 3), BURN_COLORS[2], "#ffffff", c.palette.positive];
    const reach = halfDiagonal(c) + 2;
    const shape = reach * ease.cubic(seg(c.t, 0.06, 0.52));
    const reveal = reach * ease.cubic(seg(c.t, 0.36, 0.92));
    const random = seeded(c.seed * 11 + 4);
    const short = Math.min(c.width, c.height);
    const time = c.t * 1.25;
    const fade = 1 - seg(c.t, 0.72, 1);
    const pieces = Array.from({ length: 90 }, (_, index) => {
      const angle = random() * Math.PI * 2;
      const speed = (0.55 + random() * 0.9) * reach * 1.6;
      const drag = 1 - 0.38 * time;
      const x = c.width / 2 + Math.cos(angle) * speed * time * drag;
      const y = c.height / 2 + Math.sin(angle) * speed * time * drag - 0.25 * reach * time + 0.9 * reach * time * time;
      const w = (0.022 + random() * 0.022) * short;
      const round = random() < 0.3;
      const spinTurns = (random() - 0.5) * 4;
      const flutter = Math.cos((random() * 6 + 4) * time * Math.PI);
      return { x, y, w, h: round ? w : w * 0.45, round, rotate: spinTurns * 360 * time + random() * 360, flutter, color: colors[index % colors.length] ?? "#ffffff" };
    });
    return {
      exit: {},
      enter: { style: { clipPath: `circle(${px(reveal)} at 50% 50%)` } },
      middle: shape > 0.5 ? <div style={{ position: "absolute", left: c.width / 2 - shape, top: c.height / 2 - shape, width: shape * 2, height: shape * 2, borderRadius: "50%", background: colors[0] }} /> : null,
      overlay: (
        <div style={{ position: "absolute", inset: 0, opacity: fade, pointerEvents: "none", overflow: "hidden" }}>
          {pieces.map((piece, index) => (
            <div
              key={index}
              style={{
                position: "absolute",
                left: piece.x - piece.w / 2,
                top: piece.y - piece.h / 2,
                width: piece.w,
                height: piece.h,
                borderRadius: piece.round ? "50%" : piece.h * 0.2,
                background: piece.color,
                transform: `rotate(${piece.rotate.toFixed(1)}deg) scaleY(${piece.flutter.toFixed(3)})`,
              }}
            />
          ))}
        </div>
      ),
    };
  },
};

const EFFECTS: Partial<Record<TransitionType, Effect>> = { ...basic, ...zoom, ...spin, ...motion, ...glitch, ...light, ...shapes };

export function transitionFrame(c: TransitionContext): TransitionFrame {
  const effect = EFFECTS[c.type] ?? basic.crossfade;
  return effect ? effect(c) : { exit: {}, enter: { style: { opacity: c.e } } };
}

export function hasTransitionEffect(type: TransitionType): boolean {
  return type in EFFECTS;
}
