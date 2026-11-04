import { describe, expect, it } from "vitest";

import { TRACK_IDS, composeVideo } from "./compose";
import { resolveLayerTransform } from "./evaluate";
import { checkVariety, contrastRatio, styleFingerprint } from "./fingerprint";
import { lintMotion } from "./lint";
import { VIDEO_PRESETS, generateArtDirectionBrief } from "./looks";
import { MOTION_PRESETS, applyMotionPreset } from "./motion-presets";
import {
  addLayer,
  deleteClips,
  groupLayers,
  moveClip,
  nudgeLayers,
  setKeyframe,
  splitClip,
  trimClip,
  updateLayer,
} from "./ops";
import { CompositionEditError, findClip, requireVisualClip } from "./query";
import type { SceneSpec } from "./recipes";
import type { Composition } from "./schema";
import { collectSnapTargets, nearestFreeStart, snapSpan } from "./snap";
import { ASPECT_RATIOS, formatTimecode, msToFrame, parseTimecode } from "./units";
import { parseComposition, safeParseComposition } from "./validate";

const ALL_SPECS: SceneSpec[] = [
  { kind: "headline", lines: ["Your build is *slow*", "for one reason"], eyebrow: "The problem" },
  { kind: "title", name: "Proofcut", tagline: "Videos with receipts", eyebrow: "Introducing" },
  { kind: "big-number", value: 42, suffix: "%", label: "Faster builds", line: "Measured on *1,200* CI runs" },
  { kind: "cards", heading: "What you get", cards: [
    { icon: "bolt", title: "Fast", line: "Cold start in 80 ms" },
    { icon: "shield", title: "Safe", line: "Tokens stay in the vault" },
    { icon: "eye", title: "Visible", line: "Every claim is sourced" },
  ] },
  { kind: "code", code: "const x = 1;\nexport function add(a: number, b: number) {\n  return a + b;\n}", language: "ts", title: "add.ts", caption: "Pure and tested" },
  { kind: "list", lead: "Three steps", items: ["Research", "Script", "Render"] },
  { kind: "flow", heading: "How it flows", nodes: [{ label: "Idea" }, { label: "Script" }, { label: "Video" }] },
  { kind: "quote", quote: "Proof over claims.", attribution: "Product principle 2" },
  { kind: "chart", heading: "Throughput", chart: "bar", data: [{ label: "Before", value: 3 }, { label: "After", value: 9 }] },
  { kind: "image", src: "https://example.com/a.png", caption: "The editor" },
  { kind: "end", name: "Proofcut", cta: "Try it", url: "proofcut.dev" },
];

function sample(ratio: (typeof ASPECT_RATIOS)[number] = "16:9", seed = 7): Composition {
  const brief = generateArtDirectionBrief({ seed });
  return composeVideo({
    id: "video-1",
    title: "Sample",
    ratio,
    seed,
    brief,
    scenes: ALL_SPECS.map((recipe, index) => ({ recipe, durationMs: 3000 + index * 10, lineIds: [`l${index + 1}`] })),
    voice: [{ lineId: "l1", startMs: 200, durationMs: 1800, src: "asset:voice-1", text: "Your build is slow" }],
    captions: [{ startMs: 200, durationMs: 1800, text: "Your build is slow", words: [{ text: "Your", startMs: 200, endMs: 500 }] }],
  });
}

describe("timecode", () => {
  it("formats to the millisecond and to frames", () => {
    expect(formatTimecode(1250, { fps: 30 })).toBe("00:00:01.250");
    expect(formatTimecode(1250, { fps: 30, mode: "frames" })).toBe("00:00:01:07");
    expect(formatTimecode(3_723_004, { fps: 30 })).toBe("01:02:03.004");
  });

  it("parses common forms", () => {
    expect(parseTimecode("00:00:01.250", 30)).toBe(1250);
    expect(parseTimecode("1.5s", 30)).toBe(1500);
    expect(parseTimecode("250ms", 30)).toBe(250);
    expect(parseTimecode("00:00:01:15", 30)).toBe(1500);
    expect(parseTimecode("nope", 30)).toBeNull();
    expect(msToFrame(1000, 30)).toBe(30);
  });
});

describe("compose", () => {
  it.each(ASPECT_RATIOS)("every recipe composes a valid %s video", (ratio) => {
    const composition = sample(ratio);
    expect(composition.width).toBeGreaterThan(0);
    const scenes = composition.tracks.find((track) => track.id === TRACK_IDS.scenes);
    expect(scenes?.clips).toHaveLength(ALL_SPECS.length);
    expect(composition.durationMs).toBeGreaterThan(30_000);
    // Re-parsing the output is lossless.
    expect(parseComposition(JSON.parse(JSON.stringify(composition)))).toEqual(composition);
  });

  it("is deterministic for a seed", () => {
    expect(sample("16:9", 3)).toEqual(sample("16:9", 3));
  });

  it("rejects overlapping clips and duplicate ids", () => {
    const composition = sample();
    const broken = structuredClone(composition);
    const scenes = broken.tracks[0];
    if (scenes?.kind === "visual" && scenes.clips[1]) scenes.clips[1].startMs = 100;
    const result = safeParseComposition(broken);
    expect(result.ok).toBe(false);
  });
});

describe("edit operations", () => {
  const base = sample();
  const firstClipId = "scene-1";

  it("trims the end to the millisecond and unlocks narration timing", () => {
    const next = trimClip(base, { clipId: firstClipId, edge: "end", toMs: 2250 });
    const { clip } = requireVisualClip(next, firstClipId);
    expect(clip.durationMs).toBe(2250);
    expect(clip.timing).toBe("manual");
  });

  it("refuses to trim into a neighbour without ripple", () => {
    expect(() => trimClip(base, { clipId: firstClipId, edge: "end", toMs: 4000 })).toThrow(CompositionEditError);
  });

  it("ripple-trims, shifting later clips", () => {
    const next = trimClip(base, { clipId: firstClipId, edge: "end", toMs: 4000, ripple: true });
    expect(findClip(next, "scene-2")?.clip.startMs).toBe(4000);
  });

  it("trimming the start keeps content anchored in absolute time", () => {
    const next = trimClip(base, { clipId: "scene-2", edge: "start", toMs: 3500 });
    const { clip } = requireVisualClip(next, "scene-2");
    const original = requireVisualClip(base, "scene-2").clip;
    expect(clip.startMs).toBe(3500);
    expect(clip.layers[0]?.startMs).toBe((original.layers[0]?.startMs ?? 0) - 500);
  });

  it("splits at the playhead into two editable clips", () => {
    const { composition, rightId } = splitClip(base, { clipId: firstClipId, atMs: 1200 });
    const left = requireVisualClip(composition, firstClipId).clip;
    const right = requireVisualClip(composition, rightId).clip;
    expect(left.durationMs).toBe(1200);
    expect(right.startMs).toBe(1200);
    expect(right.durationMs).toBe(1800);
    expect(right.layers.every((layer) => layer.id.endsWith("-b"))).toBe(true);
    expect(right.transitionIn).toBeUndefined();
  });

  it("moves a clip and rejects overlaps", () => {
    const freed = deleteClips(base, { clipIds: ["scene-2"] });
    const moved = moveClip(freed, { clipId: firstClipId, startMs: 3010 });
    expect(findClip(moved, firstClipId)?.clip.startMs).toBe(3010);
    expect(() => moveClip(base, { clipId: firstClipId, startMs: 3500 })).toThrow(/overlap/);
  });

  it("ripple-deletes", () => {
    const next = deleteClips(base, { clipIds: ["scene-1"], ripple: true });
    expect(findClip(next, "scene-2")?.clip.startMs).toBe(0);
  });

  it("sets keyframes and evaluates them", () => {
    const layerId = requireVisualClip(base, firstClipId).clip.layers.at(-1)?.id ?? "";
    let next = setKeyframe(base, { clipId: firstClipId, layerId, property: "x", atMs: 0, value: 10 });
    next = setKeyframe(next, { clipId: firstClipId, layerId, property: "x", atMs: 1000, value: 90, easing: "linear" });
    const layer = requireVisualClip(next, firstClipId).clip.layers.find((candidate) => candidate.id === layerId);
    expect(layer).toBeDefined();
    if (layer) expect(resolveLayerTransform(layer, 500, 1).x).toBeCloseTo(50, 5);
  });

  it("updates, nudges and groups layers", () => {
    const { composition, layerId } = addLayer(base, { clipId: firstClipId, layer: { id: "box", type: "shape", shape: "rect", fill: "#ff0000", transform: { x: 20, y: 20, width: 10, height: 10 } } });
    const { composition: withSecond } = addLayer(composition, { clipId: firstClipId, layer: { id: "box2", type: "shape", shape: "rect", transform: { x: 40, y: 20, width: 10, height: 10 } } });
    const updated = updateLayer(withSecond, { clipId: firstClipId, layerId, patch: { transform: { opacity: 0.5 } } });
    const nudged = nudgeLayers(updated, { targets: [{ clipId: firstClipId, layerId }], dxPx: 10, dyPx: 0 });
    const moved = requireVisualClip(nudged, firstClipId).clip.layers.find((layer) => layer.id === layerId);
    expect(moved?.transform.opacity).toBe(0.5);
    expect(moved?.transform.x).toBeCloseTo(20 + (10 / 1920) * 100, 6);
    const { composition: grouped, groupId } = groupLayers(nudged, { clipId: firstClipId, layerIds: ["box", "box2"] });
    const group = requireVisualClip(grouped, firstClipId).clip.layers.find((layer) => layer.id === groupId);
    expect(group?.type).toBe("group");
  });
});

describe("motion presets", () => {
  const base = sample();
  const clip = requireVisualClip(base, "scene-1").clip;
  const text = clip.layers.find((layer) => layer.type === "text");

  it("every preset id is unique", () => {
    expect(new Set(MOTION_PRESETS.map((preset) => preset.id)).size).toBe(MOTION_PRESETS.length);
  });

  it("writes ordinary keyframes and enters from 0.95, never 0", () => {
    if (!text) throw new Error("no text layer");
    const next = applyMotionPreset(base, { clipId: "scene-1", layerIds: [text.id], presetId: "scale-in" });
    const layer = requireVisualClip(next, "scene-1").clip.layers.find((candidate) => candidate.id === text.id);
    expect(layer?.keyframes.scale?.[0]?.value).toBe(0.95);
    expect(layer?.keyframes.opacity?.[0]?.value).toBe(0);
  });

  it("exits mirror the entrance", () => {
    if (!text) throw new Error("no text layer");
    const next = applyMotionPreset(base, { clipId: "scene-1", layerIds: [text.id], presetId: "fade-rise", mode: "exit" });
    const layer = requireVisualClip(next, "scene-1").clip.layers.find((candidate) => candidate.id === text.id);
    const offset = layer?.keyframes.offsetY ?? [];
    expect(offset.at(-1)?.value).toBe(36);
    expect(offset.at(-1)?.easing).toBe("exit");
  });

  it("refuses presets for the wrong layer type", () => {
    if (!text) throw new Error("no text layer");
    expect(() => applyMotionPreset(base, { clipId: "scene-1", layerIds: [text.id], presetId: "dolly-zoom" })).toThrow(CompositionEditError);
  });
});

describe("variety guard and lint", () => {
  it("flags a near-identical video and passes a different one", () => {
    const a = composeVideo({ id: "a", title: "A", ratio: "16:9", seed: 1, brief: VIDEO_PRESETS.studio!.brief, scenes: [{ durationMs: 3000, recipe: { kind: "headline", lines: ["Hi"] } }] });
    const b = composeVideo({ id: "b", title: "B", ratio: "16:9", seed: 1, brief: VIDEO_PRESETS.studio!.brief, scenes: [{ durationMs: 3000, recipe: { kind: "headline", lines: ["Yo"] } }] });
    const c = composeVideo({ id: "c", title: "C", ratio: "16:9", seed: 1, brief: VIDEO_PRESETS.editorial!.brief, scenes: [{ durationMs: 3000, recipe: { kind: "headline", lines: ["Yo"] } }] });
    const recent = [{ id: "a", title: "A", fingerprint: styleFingerprint(a) }];
    expect(checkVariety(styleFingerprint(b), recent).tooSimilar).toBe(true);
    expect(checkVariety(styleFingerprint(c), recent).tooSimilar).toBe(false);
    expect(checkVariety(styleFingerprint(b), recent, { consistencyRequested: true }).tooSimilar).toBe(false);
  });

  it("generated briefs steer away from recent fingerprints", () => {
    const recent = [styleFingerprint(sample("16:9", 11))];
    const brief = generateArtDirectionBrief({ seed: 11, avoid: recent, candidates: 12 });
    const fresh = composeVideo({ id: "f", title: "F", ratio: "16:9", seed: 11, brief, scenes: [{ durationMs: 3000, recipe: { kind: "headline", lines: ["x"] } }] });
    expect(checkVariety(styleFingerprint(fresh), [{ id: "r", title: "R", fingerprint: recent[0]! }]).tooSimilar).toBe(false);
  });

  it("lint catches scale-from-zero and ease-in entrances; recipes are clean", () => {
    const base = sample();
    expect(lintMotion(base).filter((finding) => finding.severity !== "minor")).toEqual([]);
    const { composition, layerId } = addLayer(base, {
      clipId: "scene-1",
      layer: {
        id: "bad",
        type: "shape",
        shape: "rect",
        fill: "#ff0000",
        keyframes: {
          scale: [{ atMs: 0, value: 0 }, { atMs: 500, value: 1 }],
          opacity: [{ atMs: 0, value: 0 }, { atMs: 500, value: 1, easing: "exit" }],
        },
      },
    });
    const codes = lintMotion(composition).filter((finding) => finding.layerId === layerId).map((finding) => finding.code);
    expect(codes).toContain("enter_from_nothing");
    expect(codes).toContain("ease_in_entrance");
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});

describe("snapping", () => {
  it("snaps a dragged span by its nearest edge", () => {
    const composition = sample();
    const targets = collectSnapTargets(composition, { playheadMs: 5000, excludeClipIds: new Set(["scene-1"]) });
    expect(snapSpan(4960, 1000, targets, 60).startMs).toBe(5000);
    // Head (1990) has no target nearby; the tail (2990) snaps to scene-2's start at 3000.
    expect(snapSpan(1990, 1000, targets, 60).startMs).toBe(2000);
  });

  it("finds the nearest free start", () => {
    expect(nearestFreeStart([{ id: "a", startMs: 0, durationMs: 1000 }], 500, 400)).toBe(1000);
  });
});
