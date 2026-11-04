import { type BezierPoints, cubicBezier } from "./bezier";
import { type AppleSpring, SPRINGS, type SpringName, springProgress } from "./spring";

/**
 * Named curves from the masterplan's motion rules:
 * - entrance: ease-out `cubic-bezier(0.23, 1, 0.32, 1)` — never ease-in for an entrance
 * - move: ease-in-out `cubic-bezier(0.77, 0, 0.175, 1)` — already on screen, A → B
 * - exit: ease-in, for elements leaving the way they came
 * - standard: a gentle ease for UI-like property changes
 */
export const EASING_CURVES = {
  entrance: [0.23, 1, 0.32, 1],
  move: [0.77, 0, 0.175, 1],
  exit: [0.32, 0, 0.67, 0],
  standard: [0.4, 0, 0.2, 1],
} as const satisfies Record<string, BezierPoints>;

export type CurveName = keyof typeof EASING_CURVES;
export type NamedEasing = "linear" | "hold" | CurveName | `spring-${SpringName}`;

export type Easing =
  | NamedEasing
  | { bezier: readonly [number, number, number, number] }
  | { spring: AppleSpring };

export interface ResolvedEasing {
  kind: "linear" | "hold" | "bezier" | "spring";
  /** Maps segment progress (0..1) to eased progress. For springs, see `spring`. */
  apply: (progress: number) => number;
  spring?: AppleSpring;
}

const bezierCache = new Map<string, (progress: number) => number>();

function cachedBezier(points: BezierPoints): (progress: number) => number {
  const key = points.join(",");
  let fn = bezierCache.get(key);
  if (!fn) {
    fn = cubicBezier(points);
    bezierCache.set(key, fn);
  }
  return fn;
}

export function resolveEasing(easing: Easing | undefined): ResolvedEasing {
  if (easing === undefined) return { kind: "bezier", apply: cachedBezier(EASING_CURVES.move) };
  if (typeof easing === "string") {
    if (easing === "linear") return { kind: "linear", apply: (p) => p };
    if (easing === "hold") return { kind: "hold", apply: (p) => (p >= 1 ? 1 : 0) };
    if (easing.startsWith("spring-")) {
      const name = easing.slice("spring-".length) as SpringName;
      const spring = SPRINGS[name];
      if (!spring) throw new RangeError(`Unknown spring "${name}"`);
      return { kind: "spring", apply: (p) => p, spring };
    }
    const curve = EASING_CURVES[easing as CurveName];
    if (!curve) throw new RangeError(`Unknown easing "${easing}"`);
    return { kind: "bezier", apply: cachedBezier(curve) };
  }
  if ("bezier" in easing) return { kind: "bezier", apply: cachedBezier(easing.bezier) };
  return { kind: "spring", apply: (p) => p, spring: easing.spring };
}

/**
 * Eased progress for a segment of `segmentMs` at `elapsedMs`. Springs run on
 * real time (their response, not the segment length, sets the pace) and land
 * exactly on 1 when the segment ends.
 */
export function easedSegmentProgress(easing: Easing | undefined, elapsedMs: number, segmentMs: number): number {
  if (segmentMs <= 0) return 1;
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= segmentMs) return 1;
  const resolved = resolveEasing(easing);
  if (resolved.kind === "spring" && resolved.spring) {
    return springProgress(resolved.spring, elapsedMs / 1000);
  }
  return resolved.apply(elapsedMs / segmentMs);
}

/** CSS string for an easing, for the editor UI (springs approximate via linear()). */
export function easingToCss(easing: Easing | undefined, samples = 24): string {
  const resolved = resolveEasing(easing);
  if (resolved.kind === "linear") return "linear";
  if (resolved.kind === "hold") return "steps(1, end)";
  if (typeof easing === "object" && "bezier" in easing) return `cubic-bezier(${easing.bezier.join(", ")})`;
  if (typeof easing === "string" && easing in EASING_CURVES) {
    return `cubic-bezier(${EASING_CURVES[easing as CurveName].join(", ")})`;
  }
  if (resolved.spring) {
    const points: string[] = [];
    const duration = resolved.spring.response * 2;
    for (let index = 0; index <= samples; index += 1) {
      points.push(springProgress(resolved.spring, (duration * index) / samples).toFixed(4));
    }
    return `linear(${points.join(", ")})`;
  }
  return "ease";
}

export function isEntranceSafeEasing(easing: Easing | undefined): boolean {
  if (easing === "exit") return false;
  if (typeof easing === "object" && "bezier" in easing) {
    // An ease-in curve starts slowly: the first control point hugs the time axis.
    const [x1, y1] = easing.bezier;
    return !(y1 <= 0.05 && x1 >= 0.3);
  }
  return true;
}
