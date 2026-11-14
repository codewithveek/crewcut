import { describe, expect, it } from "vitest";

import { createEmptyComposition } from "./compose";
import { applyCompositionOps } from "./composition-ops";
import { resolveLayerTransform } from "./evaluate";
import { generateArtDirectionBrief } from "./looks";
import { type SubjectSample, cropAxis, focusFor, focusKeyframes } from "./reframe";

const samples = (xs: number[], stepMs = 333, weight = 1): SubjectSample[] => xs.map((x, index) => ({ atMs: index * stepMs, x, y: 0.5, weight }));

describe("cropAxis", () => {
  it("knows which way a picture is cropped and how much shows", () => {
    // 16:9 video in a 9:16 box: cropped left-right, 31.6% shows.
    const wide = cropAxis(16 / 9, 9 / 16);
    expect(wide.axis).toBe("x");
    expect(wide.visible).toBeCloseTo(0.316, 3);
    expect(cropAxis(9 / 16, 16 / 9).axis).toBe("y");
    expect(cropAxis(16 / 9, 16 / 9).axis).toBeNull();
    expect(cropAxis(0, 1).axis).toBeNull();
  });
});

describe("focusFor", () => {
  it("centres the subject, and stops at the picture's edges", () => {
    expect(focusFor(0.5, 0.3)).toBe(50);
    expect(focusFor(0, 0.3)).toBe(0);
    expect(focusFor(1, 0.3)).toBe(100);
    expect(focusFor(0.25, 0.5)).toBe(0);
    expect(focusFor(0.4, 0.5)).toBeCloseTo(30, 5);
    expect(focusFor(0.7, 1)).toBe(50);
  });
});

describe("focusKeyframes", () => {
  const visible = 0.316;

  it("holds still for a subject that stays put", () => {
    const keyframes = focusKeyframes(samples(Array.from({ length: 30 }, (_, i) => 0.3 + (i % 2 ? 0.01 : -0.01))), "x", { visible });
    expect(keyframes).toHaveLength(1);
    expect(keyframes[0]!.atMs).toBe(0);
  });

  it("follows a subject walking across, in order, with gaps between moves", () => {
    const keyframes = focusKeyframes(samples(Array.from({ length: 40 }, (_, i) => 0.1 + (0.8 * i) / 39)), "x", { visible });
    expect(keyframes.length).toBeGreaterThan(3);
    for (let i = 1; i < keyframes.length; i += 1) {
      expect(keyframes[i]!.value).toBeGreaterThan(keyframes[i - 1]!.value);
      expect(keyframes[i]!.atMs - keyframes[i - 1]!.atMs).toBeGreaterThanOrEqual(700);
    }
    expect(keyframes.every((keyframe) => keyframe.value >= 0 && keyframe.value <= 100)).toBe(true);
  });

  it("ignores a one-frame jump", () => {
    const xs = Array.from({ length: 30 }, () => 0.5);
    xs[15] = 0.95;
    expect(focusKeyframes(samples(xs), "x", { visible })).toHaveLength(1);
  });

  it("returns nothing without samples", () => {
    expect(focusKeyframes([], "x", { visible })).toEqual([]);
  });
});

describe("reframe edit", () => {
  it("applies focus keyframes to a video layer, moves the crop over time, and can be reset", () => {
    let composition = createEmptyComposition({ id: "r", title: "R", ratio: "9:16", brief: generateArtDirectionBrief({ seed: 1 }) });
    composition = applyCompositionOps(composition, [{ op: "add-media-clip", media: { assetId: "v", mediaType: "video", durationMs: 4000 }, atMs: 0 }]);
    const clip = composition.tracks.flatMap((track) => (track.kind === "visual" ? track.clips : [])).find((entry) => entry.layers.some((layer) => layer.type === "video"))!;
    const layer = clip.layers.find((entry) => entry.type === "video")!;
    const keyframes = [
      { atMs: 0, value: 20, easing: "move" as const },
      { atMs: 2000, value: 80, easing: "move" as const },
    ];
    const moved = applyCompositionOps(composition, [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { transform: { focusX: 20, focusY: 50 }, keyframes: { focusX: keyframes, focusY: [] } } }]);
    const after = moved.tracks.flatMap((track) => (track.kind === "visual" ? track.clips : [])).find((entry) => entry.id === clip.id)!.layers.find((entry) => entry.id === layer.id)!;
    expect(resolveLayerTransform(after, 0, 1).focusX).toBeCloseTo(20);
    expect(resolveLayerTransform(after, 1000, 1).focusX).toBeGreaterThan(20);
    expect(resolveLayerTransform(after, 3000, 1).focusX).toBeCloseTo(80);
    expect(resolveLayerTransform(after, 1000, 1).focusY).toBe(50);
    const reset = applyCompositionOps(moved, [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { transform: { focusX: 50, focusY: 50 }, keyframes: { focusX: [], focusY: [] } } }]);
    const centred = reset.tracks.flatMap((track) => (track.kind === "visual" ? track.clips : [])).find((entry) => entry.id === clip.id)!.layers.find((entry) => entry.id === layer.id)!;
    expect(resolveLayerTransform(centred, 1000, 1).focusX).toBe(50);
  });
});
