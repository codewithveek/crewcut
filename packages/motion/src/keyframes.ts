import { type Easing, easedSegmentProgress } from "./easing";

/**
 * A keyframe's easing shapes the segment that ARRIVES at it (from the previous
 * keyframe). Before the first keyframe the value holds at the first value;
 * after the last it holds at the last value.
 */
export interface Keyframe {
  atMs: number;
  value: number;
  easing?: Easing | undefined;
}

export function evaluateKeyframes(keyframes: readonly Keyframe[] | undefined, timeMs: number, fallback: number): number {
  if (!keyframes || keyframes.length === 0) return fallback;
  const first = keyframes[0];
  if (!first) return fallback;
  if (timeMs <= first.atMs) return first.value;
  for (let index = 1; index < keyframes.length; index += 1) {
    const to = keyframes[index];
    const from = keyframes[index - 1];
    if (!to || !from) continue;
    if (timeMs <= to.atMs) {
      const progress = easedSegmentProgress(to.easing, timeMs - from.atMs, to.atMs - from.atMs);
      return from.value + (to.value - from.value) * progress;
    }
  }
  const last = keyframes[keyframes.length - 1];
  return last ? last.value : fallback;
}

/** Sorted copy, merging keyframes that land within `epsilonMs` (last write wins). */
export function normalizeKeyframes<K extends Keyframe>(keyframes: readonly K[], epsilonMs = 0.5): K[] {
  const sorted = [...keyframes].sort((a, b) => a.atMs - b.atMs);
  const merged: K[] = [];
  for (const keyframe of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.atMs - keyframe.atMs) <= epsilonMs) {
      merged[merged.length - 1] = keyframe;
    } else {
      merged.push(keyframe);
    }
  }
  return merged;
}

/** Inserts or replaces the keyframe at `atMs`. */
export function upsertKeyframe<K extends Keyframe>(keyframes: readonly K[], keyframe: K, epsilonMs = 0.5): K[] {
  const rest = keyframes.filter((existing) => Math.abs(existing.atMs - keyframe.atMs) > epsilonMs);
  return normalizeKeyframes([...rest, keyframe], epsilonMs);
}

/** Samples a keyframe curve for drawing it in the editor's graph view. */
export function sampleKeyframes(
  keyframes: readonly Keyframe[],
  options: { fromMs: number; toMs: number; samples: number; fallback: number },
): Array<{ atMs: number; value: number }> {
  const points: Array<{ atMs: number; value: number }> = [];
  const span = Math.max(1, options.toMs - options.fromMs);
  for (let index = 0; index <= options.samples; index += 1) {
    const atMs = options.fromMs + (span * index) / options.samples;
    points.push({ atMs, value: evaluateKeyframes(keyframes, atMs, options.fallback) });
  }
  return points;
}

/** Shifts every keyframe by `deltaMs` (used when presets are re-timed). */
export function shiftKeyframes<K extends Keyframe>(keyframes: readonly K[], deltaMs: number): K[] {
  return keyframes.map((keyframe) => ({ ...keyframe, atMs: keyframe.atMs + deltaMs }));
}
