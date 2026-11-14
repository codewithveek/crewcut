import type { Keyframe } from "./schema";

/**
 * Auto reframe: when a wide video fills a tall box (or the other way round),
 * only part of it shows. These helpers turn "where the subject is" samples
 * into a crop that follows it smoothly: `focusX` / `focusY` keyframes on the
 * layer (CSS object-position, 0–100).
 */

export interface SubjectSample {
  /** Layer-local time (ms since the layer started). */
  atMs: number;
  /** Subject centre as a share of the source picture's width / height (0..1). */
  x: number;
  y: number;
  /** How sure the sample is (0..1): busy, high-contrast frames count more. */
  weight: number;
}

/** Which way the picture is cropped in its box, and how much of it shows. */
export function cropAxis(sourceAspect: number, boxAspect: number): { axis: "x" | "y" | null; visible: number } {
  if (!(sourceAspect > 0) || !(boxAspect > 0)) return { axis: null, visible: 1 };
  const ratio = boxAspect / sourceAspect;
  // Less than 2% cropped: nothing worth following.
  if (ratio > 0.98 && ratio < 1.02) return { axis: null, visible: 1 };
  return ratio < 1 ? { axis: "x", visible: ratio } : { axis: "y", visible: 1 / ratio };
}

/** The object-position (0–100) that centres `subject` (0..1 of the source) when `visible` of it shows. */
export function focusFor(subject: number, visible: number): number {
  if (visible >= 1) return 50;
  const start = Math.min(Math.max(subject - visible / 2, 0), 1 - visible);
  return Math.round((start / (1 - visible)) * 1000) / 10;
}

export interface FocusTrackOptions {
  /** Share of the source that shows on the cropped axis (from cropAxis). */
  visible: number;
  /** Ignore moves smaller than this many focus points (0–100): no jitter. */
  deadZone?: number;
  /** At most one keyframe this often (ms). */
  minGapMs?: number;
  /** Smoothing time constant (ms): higher follows more calmly. */
  smoothingMs?: number;
}

/**
 * Keyframes that follow the subject along one axis: outliers removed (median
 * of 5), smoothed (weighted moving average over `smoothingMs`), then only the
 * moves that matter kept, eased in and out.
 */
export function focusKeyframes(samples: readonly SubjectSample[], axis: "x" | "y", options: FocusTrackOptions): Keyframe[] {
  const sorted = [...samples].filter((sample) => Number.isFinite(sample.atMs) && Number.isFinite(sample[axis])).sort((a, b) => a.atMs - b.atMs);
  if (sorted.length === 0) return [];
  const deadZone = options.deadZone ?? 6;
  const minGapMs = options.minGapMs ?? 700;
  const smoothingMs = options.smoothingMs ?? 900;
  const raw = sorted.map((sample) => Math.min(1, Math.max(0, sample[axis])));
  // Median of 5 removes one-frame jumps (a flash, a cut-away).
  const median = raw.map((_, index) => {
    const window = raw.slice(Math.max(0, index - 2), index + 3).sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)] as number;
  });
  // Weighted average over nearby samples: calm movement, confident frames count more.
  const smooth = sorted.map((sample, index) => {
    let total = 0;
    let weights = 0;
    for (let j = 0; j < sorted.length; j += 1) {
      const distance = Math.abs((sorted[j] as SubjectSample).atMs - sample.atMs);
      if (distance > smoothingMs * 2) continue;
      const weight = Math.exp(-((distance / smoothingMs) ** 2)) * Math.max(0.05, (sorted[j] as SubjectSample).weight);
      total += (median[j] as number) * weight;
      weights += weight;
    }
    return { atMs: sample.atMs, focus: focusFor(weights > 0 ? total / weights : (median[index] as number), options.visible) };
  });
  const keyframes: Keyframe[] = [{ atMs: Math.max(0, Math.round(smooth[0]!.atMs)), value: smooth[0]!.focus, easing: "move" }];
  let last = keyframes[0]!;
  for (const point of smooth.slice(1)) {
    if (point.atMs - last.atMs < minGapMs) continue;
    if (Math.abs(point.focus - last.value) < deadZone) continue;
    last = { atMs: Math.round(point.atMs), value: point.focus, easing: "move" };
    keyframes.push(last);
  }
  // Hold the last position to the end of the samples.
  const end = smooth[smooth.length - 1]!;
  if (end.atMs - last.atMs >= minGapMs && Math.abs(end.focus - last.value) >= deadZone / 2) keyframes.push({ atMs: Math.round(end.atMs), value: end.focus, easing: "move" });
  return keyframes;
}
