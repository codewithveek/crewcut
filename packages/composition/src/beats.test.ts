import { describe, expect, it } from "vitest";

import { STEADY_BEAT, beatPhaseMs, estimateTempo, onsetEnvelope, snapCutsToBeats, timelineBeats } from "./beats";
import { applyCompositionOps } from "./composition-ops";
import { clipEndMs } from "./query";
import { buildTemplate, getTemplate } from "./templates";

const RATE = 50;

/** A drum-like envelope: a hit every beat (decaying), plus a quieter off-beat and some noise. */
function clickTrack(bpm: number, offsetMs: number, seconds: number, seed = 7): Float32Array {
  let state = seed;
  const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
  const peaks = new Float32Array(seconds * RATE);
  const period = 60_000 / bpm;
  for (let index = 0; index < peaks.length; index += 1) peaks[index] = 0.08 + random() * 0.08;
  for (let at = offsetMs; at < seconds * 1000; at += period) {
    const start = Math.round((at / 1000) * RATE);
    for (let step = 0; step < 6; step += 1) if (start + step < peaks.length) peaks[start + step] = Math.max(peaks[start + step] ?? 0, 1 - step * 0.15);
    const off = Math.round(((at + period / 2) / 1000) * RATE);
    if (off < peaks.length) peaks[off] = Math.max(peaks[off] ?? 0, 0.45);
  }
  return peaks;
}

describe("beat detection", () => {
  it("finds the tempo of a steady beat", () => {
    for (const bpm of [90, 120, 128, 150]) {
      const tempo = estimateTempo(onsetEnvelope(clickTrack(bpm, 130, 20)), RATE);
      expect(tempo, `${bpm}`).not.toBeNull();
      expect(Math.abs((tempo?.bpm ?? 0) - bpm), `${bpm} → ${tempo?.bpm}`).toBeLessThan(bpm * 0.03);
      expect(tempo?.confidence ?? 0).toBeGreaterThan(STEADY_BEAT);
    }
  });

  it("reports low confidence for noise", () => {
    let state = 3;
    const noise = Float32Array.from({ length: 20 * RATE }, () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648));
    const tempo = estimateTempo(onsetEnvelope(noise), RATE);
    expect(tempo === null || tempo.confidence < STEADY_BEAT).toBe(true);
  });

  it("finds where the beat starts", () => {
    for (const offset of [0, 130, 260, 410]) {
      const phase = beatPhaseMs(onsetEnvelope(clickTrack(120, offset, 16)), RATE, 120);
      const period = 500;
      const error = Math.min(Math.abs(phase - (offset % period)), period - Math.abs(phase - (offset % period)));
      expect(error, `offset ${offset} → ${phase}`).toBeLessThanOrEqual(25);
    }
  });

  it("places beats on the timeline through trim and speed", () => {
    expect(timelineBeats({ bpm: 120, phaseMs: 100, clipStartMs: 1000, clipDurationMs: 2000, trimStartMs: 0, playbackRate: 1 })).toEqual([1100, 1600, 2100, 2600]);
    // Trimmed 300 ms into the music: the first beat at source 600 shows at 1300.
    expect(timelineBeats({ bpm: 120, phaseMs: 100, clipStartMs: 1000, clipDurationMs: 1000, trimStartMs: 300, playbackRate: 1 })).toEqual([1300, 1800]);
    // Played twice as fast: beats come every 250 ms.
    expect(timelineBeats({ bpm: 120, phaseMs: 0, clipStartMs: 0, clipDurationMs: 1000, trimStartMs: 0, playbackRate: 2 })).toEqual([0, 250, 500, 750, 1000]);
  });
});

describe("snapping cuts to the beat", () => {
  const template = getTemplate("top-five");
  if (!template) throw new Error("top-five missing");
  const composition = buildTemplate(template, { id: "vid_beats", ratio: "16:9" });
  const track = composition.tracks.find((candidate) => candidate.kind === "visual");
  if (!track || track.kind !== "visual") throw new Error("no visual track");

  it("moves every cut onto a beat and keeps clip lengths after it", () => {
    // A grid 140 ms off the template's own cuts.
    const beats = timelineBeats({ bpm: 97, phaseMs: 140, clipStartMs: 0, clipDurationMs: 40_000, trimStartMs: 0, playbackRate: 1 });
    const { ops, moved } = snapCutsToBeats(composition, { trackId: track.id, beats });
    expect(moved).toBeGreaterThan(0);
    const next = applyCompositionOps(composition, ops);
    const after = next.tracks.find((candidate) => candidate.id === track.id);
    if (!after || after.kind !== "visual") throw new Error("track lost");
    const clips = [...after.clips].sort((a, b) => a.startMs - b.startMs);
    for (let index = 0; index < clips.length - 1; index += 1) {
      const end = clipEndMs(clips[index]!);
      expect(Math.abs((clips[index + 1]?.startMs ?? 0) - end), "no gaps or overlaps").toBeLessThan(1);
      expect(beats.some((beat) => Math.abs(beat - end) <= 15), `cut at ${end} is on a beat`).toBe(true);
      expect(clips[index]!.durationMs).toBeGreaterThanOrEqual(400);
    }
    // The last clip keeps its own length.
    const lastBefore = [...track.clips].sort((a, b) => a.startMs - b.startMs).at(-1);
    expect(clips.at(-1)?.durationMs).toBe(lastBefore?.durationMs);
  });

  it("does nothing when the cuts are already on the beat", () => {
    const beats = [...track.clips].map((clip) => clipEndMs(clip));
    expect(snapCutsToBeats(composition, { trackId: track.id, beats }).moved).toBe(0);
  });

  it("only shortens clips with video", () => {
    const withVideo = {
      ...composition,
      tracks: composition.tracks.map((candidate) =>
        candidate.id === track.id && candidate.kind === "visual"
          ? { ...candidate, clips: candidate.clips.map((clip, index) => (index === 0 ? { ...clip, layers: [...clip.layers, { ...clip.layers[0]!, id: "vid-layer", type: "video" as const, src: "asset:x", fit: "cover" as const, radius: 0, trimStartMs: 0, playbackRate: 1, volume: 0, loop: false }] } : clip)) }
          : candidate,
      ),
    } as typeof composition;
    const first = [...track.clips].sort((a, b) => a.startMs - b.startMs)[0]!;
    const end = clipEndMs(first);
    // Beats just after the end (closer) and further before it: a video clip takes the earlier one.
    const { ops } = snapCutsToBeats(withVideo, { trackId: track.id, beats: [end - 200, end + 50] });
    const trim = ops.find((op) => op.op === "trim-clip" && op.clipId === first.id) as { toMs: number } | undefined;
    expect(trim?.toMs).toBe(end - 200);
  });
});
