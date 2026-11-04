/**
 * CSS-compatible cubic-bezier timing function: x is time, y is progress.
 * Newton–Raphson with a bisection fallback, as browsers do.
 */
export type BezierPoints = readonly [number, number, number, number];

const NEWTON_ITERATIONS = 8;
const NEWTON_MIN_SLOPE = 1e-3;
const SUBDIVISION_PRECISION = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 20;

function coefficientA(p1: number, p2: number): number {
  return 1 - 3 * p2 + 3 * p1;
}
function coefficientB(p1: number, p2: number): number {
  return 3 * p2 - 6 * p1;
}
function coefficientC(p1: number): number {
  return 3 * p1;
}
function sampleCurve(t: number, p1: number, p2: number): number {
  return ((coefficientA(p1, p2) * t + coefficientB(p1, p2)) * t + coefficientC(p1)) * t;
}
function sampleSlope(t: number, p1: number, p2: number): number {
  return 3 * coefficientA(p1, p2) * t * t + 2 * coefficientB(p1, p2) * t + coefficientC(p1);
}

function solveCurveX(x: number, x1: number, x2: number): number {
  let t = x;
  for (let iteration = 0; iteration < NEWTON_ITERATIONS; iteration += 1) {
    const slope = sampleSlope(t, x1, x2);
    if (Math.abs(slope) < NEWTON_MIN_SLOPE) break;
    const error = sampleCurve(t, x1, x2) - x;
    if (Math.abs(error) < SUBDIVISION_PRECISION) return t;
    t -= error / slope;
  }
  let lower = 0;
  let upper = 1;
  t = x;
  for (let iteration = 0; iteration < SUBDIVISION_MAX_ITERATIONS; iteration += 1) {
    const value = sampleCurve(t, x1, x2);
    if (Math.abs(value - x) < SUBDIVISION_PRECISION) return t;
    if (value < x) lower = t;
    else upper = t;
    t = (lower + upper) / 2;
  }
  return t;
}

export function cubicBezier(points: BezierPoints): (progress: number) => number {
  const [x1, y1, x2, y2] = points;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new RangeError("cubic-bezier x values must be within [0, 1]");
  }
  if (x1 === y1 && x2 === y2) return (progress) => clamp01(progress);
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return sampleCurve(solveCurveX(progress, x1, x2), y1, y2);
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
