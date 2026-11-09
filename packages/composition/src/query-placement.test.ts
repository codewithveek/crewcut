import { describe, expect, it } from "vitest";

import { applyCompositionOps } from "./composition-ops";
import { clipEndMs, trimBounds } from "./query";
import { buildTemplate, getTemplate } from "./templates";
import { trackGaps } from "./ops";
import { nearestFreeStart } from "./snap";

const clips = [
  { id: "a", startMs: 0, durationMs: 4000 },
  { id: "b", startMs: 5000, durationMs: 2000 },
  { id: "c", startMs: 9000, durationMs: 1000 },
];

describe("placing a dropped clip (the timeline's drop rule)", () => {
  it("keeps the drop position when it's free", () => {
    expect(nearestFreeStart(clips, 7200, 1000)).toBe(7200);
  });

  it("slides into the nearest gap that fits instead of overlapping", () => {
    // 1.5 s dropped at 4.5 s overlaps b; the 4–5 s gap is too small, so it goes right after b.
    expect(nearestFreeStart(clips, 4500, 1500)).toBe(7000);
    expect(nearestFreeStart(clips, 8500, 1000)).toBe(8000);
  });

  it("goes after the last clip when nothing earlier fits", () => {
    expect(nearestFreeStart(clips, 3000, 5000)).toBe(10000);
  });

  it("ignores the clip being moved", () => {
    expect(nearestFreeStart(clips, 5300, 2000, "b")).toBe(5300);
  });
});

describe("trimming next to other clips", () => {
  it("stops at the neighbours", () => {
    expect(trimBounds(clips, "b")).toEqual({ minStartMs: 4000, maxEndMs: 9000 });
    expect(trimBounds(clips, "a")).toEqual({ minStartMs: 0, maxEndMs: 5000 });
    expect(trimBounds(clips, "c").maxEndMs).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("reordering a clip on the main track", () => {
  const base = () => {
    const template = getTemplate("top-five");
    if (!template) throw new Error("top-five missing");
    return buildTemplate(template, { id: "vid_reorder", ratio: "16:9" });
  };
  const mainOf = (composition: ReturnType<typeof base>) => {
    const track = composition.tracks.find((candidate) => candidate.kind === "visual");
    if (!track || track.kind !== "visual") throw new Error("no main track");
    return [...track.clips].sort((a, b) => a.startMs - b.startMs);
  };

  it("moves a clip in front of another, closing and making room, with no overlaps", () => {
    const composition = base();
    const before = mainOf(composition);
    const moving = before[1]!;
    const target = before[4]!;
    const next = applyCompositionOps(composition, [{ op: "reorder-clip", clipId: moving.id, beforeClipId: target.id }]);
    const after = mainOf(next);
    expect(after.map((clip) => clip.id)).toEqual([before[0]!.id, before[2]!.id, before[3]!.id, moving.id, target.id, ...before.slice(5).map((clip) => clip.id)]);
    for (let index = 1; index < after.length; index += 1) expect(after[index]!.startMs).toBeGreaterThanOrEqual(clipEndMs(after[index - 1]!) - 0.5);
    expect(clipEndMs(after.at(-1)!)).toBe(clipEndMs(before.at(-1)!));
    expect(after.find((clip) => clip.id === moving.id)?.durationMs).toBe(moving.durationMs);
  });

  it("moves a clip to the end", () => {
    const composition = base();
    const before = mainOf(composition);
    const next = applyCompositionOps(composition, [{ op: "reorder-clip", clipId: before[0]!.id, beforeClipId: null }]);
    const after = mainOf(next);
    expect(after.at(-1)?.id).toBe(before[0]!.id);
    expect(after[0]!.startMs).toBe(0);
    expect(clipEndMs(after.at(-1)!)).toBe(clipEndMs(before.at(-1)!));
  });
});

describe("gaps", () => {
  const withGap = () => {
    const template = getTemplate("top-five");
    if (!template) throw new Error("top-five missing");
    const composition = buildTemplate(template, { id: "vid_gaps", ratio: "16:9" });
    const main = composition.tracks.find((track) => track.kind === "visual");
    if (!main || main.kind !== "visual") throw new Error("no main track");
    const last = [...main.clips].sort((a, b) => a.startMs - b.startMs).at(-1)!;
    // Moving the last clip 2 s later leaves a 2 s gap before it.
    const moved = applyCompositionOps(composition, [{ op: "move-clip", clipId: last.id, startMs: last.startMs + 2000 }]);
    return { composition: moved, trackId: main.id, last, gapFrom: last.startMs, gapTo: last.startMs + 2000 };
  };
  const trackOf = (composition: ReturnType<typeof withGap>["composition"], trackId: string) => composition.tracks.find((track) => track.id === trackId)!;

  it("lists the empty stretches between clips", () => {
    const { composition, trackId, gapFrom, gapTo } = withGap();
    expect(trackGaps(trackOf(composition, trackId))).toEqual([{ fromMs: gapFrom, toMs: gapTo }]);
  });

  it("deletes one gap: the clips after it move up", () => {
    const { composition, trackId, last, gapFrom, gapTo } = withGap();
    const next = applyCompositionOps(composition, [{ op: "close-gap", trackId, fromMs: gapFrom, toMs: gapTo }]);
    expect(trackOf(next, trackId).clips.find((clip) => clip.id === last.id)?.startMs).toBe(gapFrom);
    expect(trackGaps(trackOf(next, trackId))).toEqual([]);
  });

  it("refuses to delete space that has a clip in it", () => {
    const { composition, trackId } = withGap();
    expect(() => applyCompositionOps(composition, [{ op: "close-gap", trackId, fromMs: 0, toMs: 1000 }])).toThrow(/isn't a gap/);
  });

  it("closes every gap on a track at once", () => {
    const { composition, trackId } = withGap();
    const next = applyCompositionOps(composition, [{ op: "close-gaps", trackId }]);
    expect(trackGaps(trackOf(next, trackId))).toEqual([]);
  });
});
