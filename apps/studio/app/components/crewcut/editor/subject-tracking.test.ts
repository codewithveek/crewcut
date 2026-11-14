import { describe, expect, it } from "vitest";

import { frameSubject } from "./subject-tracking";

const W = 96;
const H = 54;

/** A flat grey frame with a busy checkered block at (left, top) of size w×h. */
function frame(left: number, top: number, w = 14, h = 18, base = 90): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const inside = x >= left && x < left + w && y >= top && y < top + h;
      const value = inside ? ((x + y) % 2 ? 230 : 30) : base;
      const i = (y * W + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe("frameSubject", () => {
  it("finds a detailed region away from the middle", () => {
    const right = frameSubject(frame(70, 18), W, H, null);
    expect(right.x).toBeGreaterThan(0.65);
    expect(right.weight).toBeGreaterThan(0.2);
    const left = frameSubject(frame(8, 18), W, H, null);
    expect(left.x).toBeLessThan(0.35);
  });

  it("follows movement between frames", () => {
    const first = frameSubject(frame(40, 18), W, H, null);
    const second = frameSubject(frame(60, 18), W, H, first.luma);
    expect(second.x).toBeGreaterThan(first.x);
  });

  it("gives a flat frame and a hard cut almost no say", () => {
    const flat = frameSubject(frame(0, 0, 0, 0), W, H, null);
    expect(flat.weight).toBeLessThan(0.05);
    const before = frameSubject(frame(10, 10, 14, 18, 20), W, H, null);
    const cut = frameSubject(frame(60, 20, 14, 18, 220), W, H, before.luma);
    expect(cut.weight).toBeLessThanOrEqual(0.05);
  });
});
