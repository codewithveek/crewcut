/**
 * The masterplan's motion rules as numbers, shared by the motion director's
 * prompts, the preset library and the QA agent's motion lint.
 */
export const MOTION_RULES = {
  /** Video is slower than UI: viewers must read on screen. */
  entranceMinMs: 400,
  entranceMaxMs: 700,
  /** Lists stagger per item so they read as one motion. */
  staggerMinMs: 40,
  staggerMaxMs: 80,
  /** Nothing appears from nothing: enter from 0.9–0.95, never from 0. */
  enterScaleMin: 0.9,
  enterScaleMax: 0.95,
  /** Blur bridges crossfades; Emil's ceiling is 20px. */
  crossfadeBlurMinPx: 2,
  crossfadeBlurMaxPx: 8,
  blurCeilingPx: 20,
  /** Reduced-motion exports swap slides and springs for short crossfades. */
  reducedMotionCrossfadeMs: 200,
} as const;

export const DEFAULT_ENTRANCE_MS = 560;
export const DEFAULT_STAGGER_MS = 60;
export const DEFAULT_ENTER_SCALE = 0.94;

export function clampStagger(staggerMs: number): number {
  return Math.min(MOTION_RULES.staggerMaxMs, Math.max(MOTION_RULES.staggerMinMs, staggerMs));
}

export function staggerOffsets(count: number, staggerMs: number = DEFAULT_STAGGER_MS): number[] {
  const step = clampStagger(staggerMs);
  return Array.from({ length: Math.max(0, count) }, (_, index) => index * step);
}
