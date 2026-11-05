import { describe, expect, it } from "vitest";

import { TRACK_IDS, composeVideo, createEmptyComposition } from "./compose";
import { applyCompositionOps } from "./composition-ops";
import { FILTER_PRESET_INFO, colorBalanceMatrix, colorFilterCss, vignetteCss } from "./effects";
import { TEXT_PRESETS } from "./elements";
import { generateArtDirectionBrief } from "./looks";
import { addCaption, addMediaClip, addTrack, duplicateClips, pasteClips, removeTrack, retimeCaptionWords, setClipSpeed, setFormat, updateCaption } from "./ops";
import { clipEndMs, findClip } from "./query";
import type { CaptionClip, Composition } from "./schema";
import { ASPECT_RATIOS, FRAME_SIZE } from "./units";
import { parseComposition } from "./validate";

function blank(): Composition {
  return createEmptyComposition({ id: "blank", title: "Blank", ratio: "16:9", brief: generateArtDirectionBrief({ seed: 3 }) });
}

function withScenes(): Composition {
  return composeVideo({
    id: "v",
    title: "Scenes",
    ratio: "16:9",
    seed: 2,
    brief: generateArtDirectionBrief({ seed: 2 }),
    scenes: [
      { recipe: { kind: "headline", lines: ["One"] }, durationMs: 2000 },
      { recipe: { kind: "headline", lines: ["Two"] }, durationMs: 2000 },
    ],
    captions: [{ startMs: 0, durationMs: 1500, text: "hello there world", words: [{ text: "hello", startMs: 0, endMs: 400 }, { text: "there", startMs: 400, endMs: 900 }, { text: "world", startMs: 900, endMs: 1500 }] }],
  });
}

const sceneTrack = (composition: Composition) => composition.tracks.find((track) => track.id === TRACK_IDS.scenes);

describe("media on the timeline", () => {
  it("inserts images magnetically on the main track and shifts later clips", () => {
    const start = withScenes();
    const { composition, clipId, trackId } = addMediaClip(start, { media: { assetId: "a1", mediaType: "image", label: "Photo" }, atMs: 2500 });
    expect(trackId).toBe(TRACK_IDS.scenes);
    const placed = findClip(composition, clipId);
    // 2500 is inside the second scene (2000–4000), in its first half → insert before it.
    expect(placed?.clip.startMs).toBe(2000);
    const scenes = sceneTrack(composition)?.clips ?? [];
    expect(scenes.map((clip) => clip.startMs).sort((a, b) => a - b)).toEqual([0, 2000, 7000]);
    expect(composition.durationMs).toBe(9000);
    expect(parseComposition(composition)).toBeTruthy();
  });

  it("drops overlay media on a free overlay track, creating one when the spot is taken", () => {
    const first = addMediaClip(blank(), { media: { assetId: "v1", mediaType: "video", durationMs: 4000 }, atMs: 500, trackId: TRACK_IDS.overlays });
    expect(first.trackId).toBe(TRACK_IDS.overlays);
    const second = addMediaClip(first.composition, { media: { assetId: "v2", mediaType: "video", durationMs: 1000 }, atMs: 1000, trackId: TRACK_IDS.overlays });
    expect(second.trackId).not.toBe(TRACK_IDS.overlays);
    expect(second.composition.tracks.filter((track) => track.kind === "visual").length).toBe(3);
    const video = findClip(second.composition, first.clipId);
    expect(video && "layers" in video.clip && video.clip.layers[0]?.type === "video" && video.clip.layers[0].volume).toBe(1);
  });

  it("routes audio to the track for its role", () => {
    const music = addMediaClip(blank(), { media: { assetId: "m", mediaType: "audio", durationMs: 30_000, kind: "music" }, atMs: 0 });
    expect(music.trackId).toBe(TRACK_IDS.music);
    const sfx = addMediaClip(music.composition, { media: { assetId: "s", mediaType: "audio", durationMs: 600 }, atMs: 100 });
    expect(sfx.trackId).toBe(TRACK_IDS.sfx);
    const clip = findClip(sfx.composition, music.clipId)?.clip;
    expect(clip && "duckUnderVoice" in clip && clip.duckUnderVoice).toBe(true);
  });
});

describe("clipboard", () => {
  it("duplicates a main-track clip right after itself and ripples the rest", () => {
    const start = withScenes();
    const first = sceneTrack(start)?.clips[0];
    const { composition, clipIds } = duplicateClips(start, { clipIds: [first?.id ?? ""] });
    const copy = findClip(composition, clipIds[0] ?? "");
    expect(copy?.clip.startMs).toBe(2000);
    expect(composition.durationMs).toBe(6000);
    // Every id stays unique.
    const ids = composition.tracks.flatMap((track) => track.clips.flatMap((clip) => ["layers" in clip ? clip.layers.map((layer) => layer.id) : [], clip.id].flat()));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pastes clips at the playhead with fresh ids, onto a free track", () => {
    const start = withScenes();
    const clip = sceneTrack(start)?.clips[1];
    if (!clip) throw new Error("no clip");
    const { composition, clipIds } = pasteClips(start, { atMs: 500, items: [{ trackId: TRACK_IDS.scenes, track: { kind: "visual" }, clip }] });
    const pasted = findClip(composition, clipIds[0] ?? "");
    expect(pasted?.clip.id).not.toBe(clip.id);
    expect(pasted?.clip.startMs).toBe(500);
    expect(pasted?.track.id).not.toBe(TRACK_IDS.scenes);
  });
});

describe("tracks and format", () => {
  it("adds and removes tracks but never the main track", () => {
    const { composition, trackId } = addTrack(blank(), { kind: "audio", role: "sfx" });
    expect(composition.tracks.find((track) => track.id === trackId)?.name).toBe("Sound FX 2");
    expect(removeTrack(composition, { trackId }).tracks.length).toBe(composition.tracks.length - 1);
    expect(() => removeTrack(blank(), { trackId: TRACK_IDS.scenes })).not.toThrow();
    const onlyMain = removeTrack(blank(), { trackId: TRACK_IDS.overlays });
    expect(() => removeTrack(onlyMain, { trackId: TRACK_IDS.scenes })).toThrow(/main track/);
  });

  it("switches between every aspect ratio with a 1080 short side", () => {
    for (const ratio of ASPECT_RATIOS) {
      const next = setFormat(blank(), { ratio });
      expect(next.ratio).toBe(ratio);
      expect(Math.min(next.width, next.height)).toBe(1080);
      expect({ width: next.width, height: next.height }).toEqual(FRAME_SIZE[ratio]);
    }
  });

  it("scales a clip's length with its speed and makes room after it", () => {
    const withAudio = addMediaClip(blank(), { media: { assetId: "a", mediaType: "audio", durationMs: 2000, kind: "sfx" }, atMs: 0 });
    const after = addMediaClip(withAudio.composition, { media: { assetId: "b", mediaType: "audio", durationMs: 1000, kind: "sfx" }, atMs: 2000 });
    const slowed = setClipSpeed(after.composition, { clipId: withAudio.clipId, rate: 0.5 });
    const clip = findClip(slowed, withAudio.clipId)?.clip;
    expect(clip?.durationMs).toBe(4000);
    expect(findClip(slowed, after.clipId)?.clip.startMs).toBe(4000);
  });
});

describe("captions", () => {
  it("keeps word timings when the word count is unchanged, else spreads by length", () => {
    const start = withScenes();
    const cue = start.tracks.find((track) => track.kind === "caption")?.clips[0] as CaptionClip;
    expect(retimeCaptionWords(cue, "hi there world").map((word) => word.startMs)).toEqual([0, 400, 900]);
    const respaced = retimeCaptionWords(cue, "a much longer caption");
    expect(respaced[0]?.startMs).toBe(0);
    expect(respaced[respaced.length - 1]?.endMs).toBe(1500);
    const edited = updateCaption(start, { clipId: cue.id, text: "  Hello   again  " });
    const updated = findClip(edited, cue.id)?.clip as CaptionClip;
    expect(updated.text).toBe("Hello again");
    expect(updated.words.map((word) => word.text)).toEqual(["Hello", "again"]);
  });

  it("adds a caption cue and refuses overlaps", () => {
    const { composition, clipId } = addCaption(withScenes(), { atMs: 2000, text: "new cue" });
    const cue = findClip(composition, clipId)?.clip as CaptionClip;
    expect(cue.words).toHaveLength(2);
    expect(clipEndMs(cue)).toBe(4000);
    expect(() => addCaption(composition, { atMs: 100, text: "x" })).toThrow(/overlap/);
  });
});

describe("batched ops", () => {
  it("applies a mixed batch the same way the server does", () => {
    const brief = generateArtDirectionBrief({ seed: 3 });
    const title = TEXT_PRESETS.find((preset) => preset.id === "title")?.build(brief, "Hello");
    if (!title) throw new Error("preset");
    const next = applyCompositionOps(blank(), [
      { op: "set-format", ratio: "9:16" },
      { op: "add-element-clip", layer: title, atMs: 0, durationMs: 2500 },
      { op: "add-caption", atMs: 0, text: "Hello world" },
      { op: "set-caption-style", style: { preset: "outline", positionY: 70 } },
    ]);
    expect(next.ratio).toBe("9:16");
    expect(next.tracks.find((track) => track.kind === "caption" && track.style.preset === "outline")).toBeTruthy();
    expect(next.tracks.find((track) => track.id === TRACK_IDS.overlays)?.clips[0]?.durationMs).toBe(2500);
  });

  it("rejects an invalid op without changing anything", () => {
    const start = blank();
    expect(() => applyCompositionOps(start, [{ op: "set-format", ratio: "7:3" as never }])).toThrow();
  });
});

describe("colour effects", () => {
  it("builds CSS filters, a white-balance matrix and a vignette", () => {
    expect(Object.keys(FILTER_PRESET_INFO)).toHaveLength(10);
    expect(colorFilterCss({ filter: { preset: "mono", intensity: 1 } })).toBe("grayscale(1) contrast(1.08)");
    expect(colorFilterCss({ filter: { preset: "mono", intensity: 0.5 } })).toBe("grayscale(0.5) contrast(1.04)");
    const adjust = { brightness: 20, contrast: 0, saturation: -50, hue: 0, temperature: 50, tint: 0, vignette: 40 };
    expect(colorFilterCss({ adjust }, { matrixFilterId: "f1" })).toBe("url(#f1) brightness(1.1) saturate(0.5)");
    expect(colorBalanceMatrix(adjust)?.startsWith("1.09 ")).toBe(true);
    expect(vignetteCss(adjust)).toContain("radial-gradient");
    expect(colorFilterCss({})).toBeUndefined();
  });
});

describe("model tool-call filler", () => {
  it("ignores null / empty filler in drafts but keeps null removals in patches", () => {
    const base = blank();
    const filled = applyCompositionOps(base, [
      {
        op: "add-element-clip",
        layer: { type: "text", text: "Hello", id: null, name: "", style: { size: 120, color: null }, shape: null, fill: "", data: [], transform: {} },
        atMs: 0,
        durationMs: null,
        trackId: "",
        clipId: null,
        name: null,
      } as never,
    ]);
    const clip = filled.tracks.find((track) => track.id === TRACK_IDS.overlays)?.clips[0];
    const layer = clip && "layers" in clip ? clip.layers[0] : undefined;
    expect(layer?.type === "text" && layer.text).toBe("Hello");
    expect(layer?.type === "text" && layer.style.size).toBe(120);
    if (!clip || !layer) throw new Error("no layer");
    const withFilter = applyCompositionOps(filled, [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { filter: { preset: "mono", intensity: 1 } } }]);
    const cleared = applyCompositionOps(withFilter, [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { filter: null } }]);
    const after = cleared.tracks.find((track) => track.id === TRACK_IDS.overlays)?.clips[0];
    expect(after && "layers" in after ? after.layers[0]?.filter : "missing").toBeUndefined();
  });
});
