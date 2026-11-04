import { clipEndMs } from "./query";
import type { Composition } from "./schema";

export interface SnapTarget {
  atMs: number;
  kind: "playhead" | "clip-start" | "clip-end" | "marker" | "beat" | "zero";
}

export function collectSnapTargets(
  composition: Composition,
  options: { playheadMs?: number; excludeClipIds?: ReadonlySet<string>; beatsMs?: readonly number[] } = {},
): SnapTarget[] {
  const targets: SnapTarget[] = [{ atMs: 0, kind: "zero" }];
  if (options.playheadMs !== undefined) targets.push({ atMs: options.playheadMs, kind: "playhead" });
  for (const track of composition.tracks) {
    for (const clip of track.clips) {
      if (options.excludeClipIds?.has(clip.id)) continue;
      targets.push({ atMs: clip.startMs, kind: "clip-start" }, { atMs: clipEndMs(clip), kind: "clip-end" });
    }
  }
  for (const marker of composition.markers) targets.push({ atMs: marker.atMs, kind: "marker" });
  for (const beat of options.beatsMs ?? []) targets.push({ atMs: beat, kind: "beat" });
  return targets;
}

/** Snaps `timeMs` to the nearest target within `thresholdMs`. */
export function snapTime(
  timeMs: number,
  targets: readonly SnapTarget[],
  thresholdMs: number,
): { timeMs: number; target: SnapTarget | null } {
  let best: SnapTarget | null = null;
  let bestDistance = thresholdMs;
  for (const target of targets) {
    const distance = Math.abs(target.atMs - timeMs);
    if (distance <= bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best ? { timeMs: best.atMs, target: best } : { timeMs, target: null };
}

/**
 * Snaps a moving span [start, start+duration] by whichever edge is closer to a
 * target — dragging a clip snaps its head or its tail.
 */
export function snapSpan(
  startMs: number,
  durationMs: number,
  targets: readonly SnapTarget[],
  thresholdMs: number,
): { startMs: number; target: SnapTarget | null } {
  const head = snapTime(startMs, targets, thresholdMs);
  const tail = snapTime(startMs + durationMs, targets, thresholdMs);
  const headDistance = head.target ? Math.abs(head.timeMs - startMs) : Number.POSITIVE_INFINITY;
  const tailDistance = tail.target ? Math.abs(tail.timeMs - (startMs + durationMs)) : Number.POSITIVE_INFINITY;
  if (headDistance === Number.POSITIVE_INFINITY && tailDistance === Number.POSITIVE_INFINITY) return { startMs, target: null };
  return headDistance <= tailDistance
    ? { startMs: head.timeMs, target: head.target }
    : { startMs: tail.timeMs - durationMs, target: tail.target };
}

/** Nearest free start on a track for a clip of `durationMs`, near `desiredMs`. */
export function nearestFreeStart(
  clips: ReadonlyArray<{ id: string; startMs: number; durationMs: number }>,
  desiredMs: number,
  durationMs: number,
  ignoreId?: string,
): number {
  const others = clips.filter((clip) => clip.id !== ignoreId).sort((a, b) => a.startMs - b.startMs);
  const fits = (start: number) =>
    start >= 0 && others.every((clip) => start + durationMs <= clip.startMs + 0.5 || start >= clipEndMs(clip) - 0.5);
  if (fits(desiredMs)) return desiredMs;
  const candidates = [0, ...others.map((clip) => clipEndMs(clip)), ...others.map((clip) => clip.startMs - durationMs)].filter(fits);
  if (candidates.length === 0) return others.length ? clipEndMs(others[others.length - 1] as (typeof others)[number]) : 0;
  return candidates.reduce((best, candidate) => (Math.abs(candidate - desiredMs) < Math.abs(best - desiredMs) ? candidate : best));
}
