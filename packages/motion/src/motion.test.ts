import { describe, expect, it } from "vitest";

import { createSeededRandom, ambientOffset } from "./ambient";
import { cubicBezier } from "./bezier";
import { EASING_CURVES, easedSegmentProgress, isEntranceSafeEasing } from "./easing";
import { evaluateKeyframes, upsertKeyframe } from "./keyframes";
import { staggerOffsets } from "./rules";
import {
  SPRINGS,
  fromRemotionSpring,
  springOvershoot,
  springProgress,
  springSettleSeconds,
  toRemotionSpring,
} from "./spring";

describe("apple → remotion spring conversion", () => {
  it("matches the masterplan formula (k = (2π/response)², c = 4πζ/response)", () => {
    const config = toRemotionSpring({ dampingRatio: 1, response: 0.5 });
    expect(config.stiffness).toBeCloseTo((2 * Math.PI / 0.5) ** 2, 6);
    expect(config.damping).toBeCloseTo((4 * Math.PI * 1) / 0.5, 6);
    expect(config.mass).toBe(1);
  });

  it("round-trips", () => {
    const back = fromRemotionSpring(toRemotionSpring({ dampingRatio: 0.8, response: 0.42 }));
    expect(back.dampingRatio).toBeCloseTo(0.8, 6);
    expect(back.response).toBeCloseTo(0.42, 6);
  });

  it("rejects non-positive parameters", () => {
    expect(() => toRemotionSpring({ dampingRatio: 1, response: 0 })).toThrow(RangeError);
  });
});

describe("spring progress", () => {
  it("starts at rest and converges to 1", () => {
    for (const spring of Object.values(SPRINGS)) {
      expect(springProgress(spring, 0)).toBe(0);
      expect(springProgress(spring, spring.response * 8)).toBeCloseTo(1, 3);
    }
  });

  it("never overshoots when critically damped", () => {
    for (let t = 0; t < 2; t += 0.01) {
      expect(springProgress(SPRINGS.smooth, t)).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(springOvershoot(SPRINGS.smooth)).toBe(0);
  });

  it("overshoots with momentum (ζ = 0.8)", () => {
    let peak = 0;
    for (let t = 0; t < 2; t += 0.002) peak = Math.max(peak, springProgress(SPRINGS.momentum, t));
    expect(peak).toBeGreaterThan(1);
    expect(peak - 1).toBeCloseTo(springOvershoot(SPRINGS.momentum), 2);
  });

  it("overdamped springs are monotonic", () => {
    let previous = 0;
    for (let t = 0; t < 2; t += 0.01) {
      const value = springProgress({ dampingRatio: 1.6, response: 0.4 }, t);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = value;
    }
  });

  it("settles within a few responses", () => {
    const settle = springSettleSeconds(SPRINGS.smooth);
    expect(settle).toBeGreaterThan(0.3);
    expect(settle).toBeLessThan(1.5);
  });
});

describe("cubic bezier", () => {
  it("hits the endpoints and is monotonic for the entrance curve", () => {
    const ease = cubicBezier(EASING_CURVES.entrance);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let previous = 0;
    for (let x = 0; x <= 1; x += 0.05) {
      expect(ease(x)).toBeGreaterThanOrEqual(previous);
      previous = ease(x);
    }
    // Ease-out: fast start.
    expect(ease(0.25)).toBeGreaterThan(0.6);
  });

  it("matches a linear curve", () => {
    const linear = cubicBezier([0.25, 0.25, 0.75, 0.75]);
    expect(linear(0.3)).toBeCloseTo(0.3, 6);
  });
});

describe("keyframes", () => {
  const keyframes = [
    { atMs: 0, value: 0 },
    { atMs: 1000, value: 100, easing: "linear" as const },
    { atMs: 2000, value: 50, easing: "hold" as const },
  ];

  it("holds before the first and after the last keyframe", () => {
    expect(evaluateKeyframes(keyframes, -10, 7)).toBe(0);
    expect(evaluateKeyframes(keyframes, 5000, 7)).toBe(50);
    expect(evaluateKeyframes([], 100, 7)).toBe(7);
  });

  it("interpolates with the arriving keyframe's easing", () => {
    expect(evaluateKeyframes(keyframes, 500, 0)).toBeCloseTo(50, 6);
    expect(evaluateKeyframes(keyframes, 1500, 0)).toBe(100);
    expect(evaluateKeyframes(keyframes, 2000, 0)).toBe(50);
  });

  it("spring segments land exactly on their target", () => {
    const sprung = [
      { atMs: 0, value: 0.94 },
      { atMs: 900, value: 1, easing: "spring-smooth" as const },
    ];
    expect(evaluateKeyframes(sprung, 900, 0)).toBe(1);
    expect(evaluateKeyframes(sprung, 200, 0)).toBeGreaterThan(0.94);
  });

  it("upserts by time", () => {
    const next = upsertKeyframe(keyframes, { atMs: 1000, value: 5 });
    expect(next).toHaveLength(3);
    expect(next[1]?.value).toBe(5);
  });

  it("eased progress clamps outside the segment", () => {
    expect(easedSegmentProgress("entrance", -5, 100)).toBe(0);
    expect(easedSegmentProgress("entrance", 150, 100)).toBe(1);
  });
});

describe("rules and determinism", () => {
  it("clamps stagger to 40–80 ms", () => {
    expect(staggerOffsets(3, 10)).toEqual([0, 40, 80]);
    expect(staggerOffsets(3, 500)).toEqual([0, 80, 160]);
  });

  it("flags ease-in as unsafe for entrances", () => {
    expect(isEntranceSafeEasing("exit")).toBe(false);
    expect(isEntranceSafeEasing({ bezier: [0.42, 0, 1, 1] })).toBe(false);
    expect(isEntranceSafeEasing("entrance")).toBe(true);
  });

  it("is deterministic", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(ambientOffset({ kind: "float", amplitude: 10, periodMs: 3000 }, 1234, "layer-1")).toEqual(
      ambientOffset({ kind: "float", amplitude: 10, periodMs: 3000 }, 1234, "layer-1"),
    );
  });
});
