import { describe, expect, it } from "vitest";

import { CREWCUT_ENDING_MS, hasCrewcutEnding, isCrewcutEnding, withCrewcutEnding, withoutCrewcutEnding } from "./ending";
import { lintMotion } from "./lint";
import { ASPECT_RATIOS } from "./units";
import { validateComposition } from "./validate";
import { buildTemplate, getTemplate } from "./templates";

describe("Crewcut ending", () => {
  const template = getTemplate("kinetic-quote");
  if (!template) throw new Error("missing template");

  for (const ratio of ASPECT_RATIOS.filter((entry) => template.ratios.includes(entry))) {
    it(`adds a valid ending after the last scene in ${ratio}`, () => {
      const base = buildTemplate(template, { id: "vid_end", ratio });
      const ended = withCrewcutEnding(base);
      const main = ended.tracks.find((track) => track.kind === "visual");
      const last = main?.clips.at(-1);
      expect(last && "recipe" in last && isCrewcutEnding(last)).toBe(true);
      expect(ended.durationMs).toBe(base.durationMs + CREWCUT_ENDING_MS);
      expect(validateComposition(ended).filter((issue) => issue.severity === "error")).toEqual([]);
      expect(lintMotion(ended).filter((finding) => finding.severity === "blocker")).toEqual([]);
      // Logo and wordmark stay inside the frame.
      for (const layer of last && "layers" in last ? last.layers : []) {
        expect(layer.transform.x, layer.id).toBeGreaterThan(5);
        expect(layer.transform.x, layer.id).toBeLessThan(95);
      }
    });
  }

  it("is added once and removed cleanly", () => {
    const base = buildTemplate(template, { id: "vid_end", ratio: "16:9" });
    const twice = withCrewcutEnding(withCrewcutEnding(base));
    const clips = twice.tracks.flatMap((track) => track.clips as readonly object[] as ReadonlyArray<{ recipe?: string }>);
    expect(clips.filter((clip) => isCrewcutEnding(clip))).toHaveLength(1);
    const removed = withoutCrewcutEnding(twice);
    expect(hasCrewcutEnding(removed)).toBe(false);
    expect(removed.durationMs).toBe(base.durationMs);
  });
});
