import { describe, expect, it } from "vitest";

import { composeVideo } from "./compose";
import { setTransition } from "./ops";
import { TRANSITION_TYPES, transitionSchema } from "./schema";
import { TRANSITION_CATALOG, TRANSITION_GROUPS, TRANSITION_PRESETS, defaultTransition } from "./transitions";
import { VIDEO_PRESETS } from "./looks";

describe("transition catalogue", () => {
  it("describes every transition type", () => {
    for (const type of TRANSITION_TYPES) {
      const info = TRANSITION_CATALOG[type];
      expect(info, type).toBeDefined();
      expect(TRANSITION_GROUPS).toContain(info.group);
      expect(info.stillAt).toBeGreaterThan(0);
      expect(info.stillAt).toBeLessThan(1);
    }
  });

  it("has valid, uniquely named presets that cover every type", () => {
    const ids = TRANSITION_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of TRANSITION_PRESETS) expect(() => transitionSchema.parse(preset.transition)).not.toThrow();
    const covered = new Set(TRANSITION_PRESETS.map((preset) => preset.transition.type));
    for (const type of TRANSITION_TYPES) expect(covered.has(type), type).toBe(true);
  });

  it("only gives directions a type understands", () => {
    for (const preset of TRANSITION_PRESETS) {
      const { directions } = TRANSITION_CATALOG[preset.transition.type];
      if (directions.length) expect(directions).toContain(preset.transition.direction);
    }
  });

  it("takes the new type's length when only the type changes", () => {
    const brief = VIDEO_PRESETS.studio?.brief;
    if (!brief) throw new Error("no preset");
    const scene = (line: string) => ({ durationMs: 3000, recipe: { kind: "headline" as const, lines: [line] } });
    const composition = composeVideo({ id: "t", title: "T", ratio: "16:9", seed: 1, brief, scenes: [scene("A"), scene("B")] });
    const track = composition.tracks.find((entry) => entry.kind === "visual");
    const second = track?.kind === "visual" ? track.clips[1] : undefined;
    if (!second) throw new Error("no second clip");
    const crossfaded = setTransition(composition, { clipId: second.id, transition: { type: "crossfade", durationMs: 400 } });
    const burned = setTransition(crossfaded, { clipId: second.id, transition: { type: "film-burn" } });
    const clip = burned.tracks.flatMap((entry) => (entry.kind === "visual" ? entry.clips : [])).find((entry) => entry.id === second.id);
    expect(clip?.transitionIn).toEqual(defaultTransition("film-burn"));
    const longer = setTransition(burned, { clipId: second.id, transition: { durationMs: 1400 } });
    const kept = longer.tracks.flatMap((entry) => (entry.kind === "visual" ? entry.clips : [])).find((entry) => entry.id === second.id);
    expect(kept?.transitionIn?.durationMs).toBe(1400);
    expect(kept?.transitionIn?.type).toBe("film-burn");
  });
});
