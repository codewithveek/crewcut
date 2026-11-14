import { type Composition, applyCompositionOps, composeVideo, generateArtDirectionBrief, parseComposition } from "@crewcut/composition";
import { placeWords } from "@crewcut/voice";
import { describe, expect, it } from "vitest";

import { captionStyleFor, speechCaptionOps, speechSources } from "./speech-captions";

/** Two 2 s scenes, a talking video (6 s, trimmed 1 s in) after them, a recorded voice clip, a music bed and two old captions. */
function project(ratio: "16:9" | "9:16" = "9:16"): Composition {
  const base = composeVideo({
    id: "v",
    title: "Talk",
    ratio,
    seed: 2,
    brief: generateArtDirectionBrief({ seed: 2 }),
    scenes: [
      { recipe: { kind: "headline", lines: ["One"] }, durationMs: 2000 },
      { recipe: { kind: "headline", lines: ["Two"] }, durationMs: 2000 },
    ],
    captions: [
      { startMs: 0, durationMs: 1500, text: "intro words", words: [] },
      { startMs: 4500, durationMs: 800, text: "old caption", words: [] },
    ],
  });
  let composition = applyCompositionOps(base, [{ op: "add-media-clip", media: { assetId: "talk", mediaType: "video", durationMs: 6000, label: "Talking head" }, atMs: 4000 }]);
  const visualClips = composition.tracks.flatMap((track) => (track.kind === "visual" ? track.clips : []));
  const talk = visualClips.find((clip) => clip.layers.some((layer) => layer.type === "video"))!;
  const layer = talk.layers.find((entry) => entry.type === "video")!;
  composition = applyCompositionOps(composition, [{ op: "update-layer", clipId: talk.id, layerId: layer.id, patch: { trimStartMs: 1000 } }]);
  composition = applyCompositionOps(composition, [{ op: "add-track", track: { kind: "audio", role: "voice" }, id: "rec" }]);
  composition = applyCompositionOps(composition, [{ op: "add-clip", trackId: "rec", clip: { id: "rec-1", startMs: 500, durationMs: 1000, src: "asset:rec" } }]);
  return composition;
}

describe("speechSources", () => {
  it("finds heard video layers and recordings, with their timing", () => {
    const sources = speechSources(project());
    const video = sources.find((source) => source.assetId === "talk")!;
    expect(video.placement).toMatchObject({ trimStartMs: 1000, playbackRate: 1, windowStartMs: 4000 });
    expect(video.placement.windowEndMs - video.placement.windowStartMs).toBeGreaterThan(0);
    expect(sources.find((source) => source.assetId === "rec")).toMatchObject({ clipId: "rec-1", placement: { windowStartMs: 500, windowEndMs: 1500 } });
  });

  it("skips muted video and narration, but takes a named clip even when muted", () => {
    const composition = project();
    const talk = speechSources(composition).find((source) => source.assetId === "talk")!;
    const muted = applyCompositionOps(composition, [{ op: "update-layer", clipId: talk.clipId, layerId: talk.layerId!, patch: { volume: 0 } }]);
    expect(speechSources(muted).some((source) => source.assetId === "talk")).toBe(false);
    expect(speechSources(muted, { clipId: talk.clipId }).map((source) => source.assetId)).toEqual(["talk"]);
    const narrated = applyCompositionOps(composition, [{ op: "update-clip", clipId: "rec-1", patch: { lineId: "line-1" } }]);
    expect(speechSources(parseComposition(narrated)).some((source) => source.assetId === "rec")).toBe(false);
  });
});

describe("speechCaptionOps", () => {
  it("replaces only the captions where the clip plays, and the edit applies cleanly", () => {
    const composition = project();
    const source = speechSources(composition).find((entry) => entry.assetId === "talk")!;
    // Source words at 1.0–3.0 s; the clip starts playing the file at 1.0 s, at 4.0 s on the timeline.
    const words = placeWords(
      [
        { text: "Hello", startMs: 1000, endMs: 1300 },
        { text: "there,", startMs: 1350, endMs: 1700 },
        { text: "how", startMs: 2000, endMs: 2200 },
        { text: "are", startMs: 2250, endMs: 2400 },
        { text: "you?", startMs: 2450, endMs: 3000 },
      ],
      source.placement,
    );
    expect(words[0]).toEqual({ text: "Hello", startMs: 4000, endMs: 4300 });
    const { ops, cues } = speechCaptionOps(composition, [{ ...source.placement, words }]);
    expect(cues).toBeGreaterThan(0);
    const next = applyCompositionOps(composition, ops);
    const captions = next.tracks.find((track) => track.kind === "caption")!.clips;
    // "intro words" (0–1.5 s) stays; "old caption" (4.5 s) sat inside the clip and is replaced.
    expect(captions.map((clip) => clip.text)).toContain("intro words");
    expect(captions.map((clip) => clip.text)).not.toContain("old caption");
    expect(captions.map((clip) => clip.text).join(" ")).toContain("Hello there,");
    const sorted = [...captions].sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < sorted.length; i += 1) expect(sorted[i]!.startMs).toBeGreaterThanOrEqual(sorted[i - 1]!.startMs + sorted[i - 1]!.durationMs);
  });

  it("adds a caption track when there is none, and stops before kept captions and the video's end", () => {
    const composition = project();
    const withoutCaptions = applyCompositionOps(composition, [{ op: "remove-track", trackId: composition.tracks.find((track) => track.kind === "caption")!.id }]);
    const { ops } = speechCaptionOps(withoutCaptions, [{ windowStartMs: 0, windowEndMs: 1000, words: [{ text: "Hi", startMs: 100, endMs: 150 }] }]);
    expect(ops[0]).toMatchObject({ op: "add-track", track: { kind: "caption" } });
    expect(applyCompositionOps(withoutCaptions, ops).tracks.filter((track) => track.kind === "caption")).toHaveLength(1);

    // A cue right before a kept caption is cut at its start, and words that no longer fit are dropped.
    const kept = applyCompositionOps(composition, []);
    const clamp = speechCaptionOps(kept, [
      {
        windowStartMs: 2000,
        windowEndMs: 4400,
        words: [
          { text: "first", startMs: 4200, endMs: 4300 },
          { text: "second", startMs: 4350, endMs: 4800 },
        ],
      },
    ]);
    // "old caption" starts at 4500: it overlaps 2000–4400? No (4500 ≥ 4400), so it's kept and blocks the cue.
    const added = clamp.ops.flatMap((op) => (op.op === "add-clip" ? [op as unknown as { clip: { startMs: number; durationMs: number; text: string; words: unknown[] } }] : []));
    expect(added).toHaveLength(1);
    expect(added[0]!.clip.startMs + added[0]!.clip.durationMs).toBeLessThanOrEqual(4500);
    expect(() => applyCompositionOps(kept, clamp.ops)).not.toThrow();

    const atEnd = speechCaptionOps(kept, [{ windowStartMs: kept.durationMs - 300, windowEndMs: kept.durationMs, words: [{ text: "bye", startMs: kept.durationMs - 100, endMs: kept.durationMs - 50 }] }]);
    const last = atEnd.ops.find((op) => op.op === "add-clip") as unknown as { clip: { startMs: number; durationMs: number } };
    expect(last.clip.startMs + last.clip.durationMs).toBeLessThanOrEqual(kept.durationMs);
  });

  it("uses longer lines on wide videos", () => {
    expect(captionStyleFor("16:9").maxWords).toBeGreaterThan(captionStyleFor("9:16").maxWords);
    expect(captionStyleFor("1:1").maxWords).toBe(captionStyleFor("9:16").maxWords);
  });
});
