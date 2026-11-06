import { describe, expect, it } from "vitest";

import { lintMotion } from "../lint";
import { validateComposition } from "../validate";
import { TEMPLATES, buildTemplate, closestTemplateRatio, getTemplate, isPlaceholderPhoto, searchTemplates, templateDurationMs } from "./index";

function slotLayers(composition: ReturnType<typeof buildTemplate>) {
  return composition.tracks.flatMap((track) => (track.kind === "visual" ? track.clips.flatMap((clip) => clip.layers) : []));
}

describe("template library", () => {
  it("has unique ids and only sensible lengths (4–30 s)", () => {
    expect(new Set(TEMPLATES.map((template) => template.id)).size).toBe(TEMPLATES.length);
    for (const template of TEMPLATES) {
      const seconds = templateDurationMs(template) / 1000;
      expect(seconds, template.id).toBeGreaterThanOrEqual(4);
      expect(seconds, template.id).toBeLessThanOrEqual(30);
    }
  });

  for (const template of TEMPLATES) {
    for (const ratio of template.ratios) {
      it(`${template.id} builds a valid ${ratio} composition with every slot in use`, () => {
        const composition = buildTemplate(template, { id: "vid_test", ratio });
        expect(composition.ratio).toBe(ratio);
        expect(validateComposition(composition).filter((issue) => issue.severity === "error")).toEqual([]);
        const used = new Set(slotLayers(composition).map((layer) => layer.slot).filter(Boolean));
        for (const slot of template.slots) expect(used.has(slot.id), `${template.id}: slot ${slot.id} unused in ${ratio}`).toBe(true);
        // Sample copy respects the slot's own length limit.
        for (const slot of template.slots) if (slot.kind === "text" && slot.maxLength) expect(slot.default.replace(/\*/g, "").length, slot.id).toBeLessThanOrEqual(slot.maxLength);
        // Frame 0 is never empty: something is on screen at the first frame.
        const first = composition.tracks.find((track) => track.kind === "visual")?.clips[0];
        expect(first && "layers" in first ? first.layers.some((layer) => layer.startMs <= 0) : false).toBe(true);
        // Pulses are subtle: amplitude is a scale delta (0.04 = 4%), not a percentage.
        for (const layer of slotLayers(composition)) if (layer.ambient?.kind === "pulse") expect(layer.ambient.amplitude, layer.id).toBeLessThanOrEqual(0.2);
        // No motion blockers (blur ceiling, scale-from-zero, unreadable contrast, …).
        expect(lintMotion(composition).filter((finding) => finding.severity === "blocker")).toEqual([]);
      });
    }
  }

  it("fills slots with the person's words and photos, keeping placeholders elsewhere", () => {
    const template = getTemplate("golden-hour");
    if (!template) throw new Error("missing template");
    const composition = buildTemplate(template, { id: "vid_x", ratio: "9:16", values: { title: "Porto *nights*", "photo-1": "asset:abc" } });
    const layers = slotLayers(composition);
    const title = layers.find((layer) => layer.slot === "title");
    const first = layers.find((layer) => layer.slot === "photo-1");
    const second = layers.find((layer) => layer.slot === "photo-2");
    expect(title && "text" in title ? title.text : "").toBe("Porto *nights*");
    expect(first && "src" in first ? first.src : "").toBe("asset:abc");
    expect(second && "src" in second ? isPlaceholderPhoto(second.src) : false).toBe(true);
  });

  it("uses the closest designed ratio and searches by words, ratio and category", () => {
    const template = getTemplate("product-drop");
    if (!template) throw new Error("missing template");
    expect(closestTemplateRatio(template, "16:9")).toBe("1:1");
    expect(searchTemplates({ query: "launch" }).map((entry) => entry.id)).toContain("product-drop");
    expect(searchTemplates({ ratio: "16:9" }).every((entry) => entry.ratios.includes("16:9"))).toBe(true);
    expect(searchTemplates({ category: "quote" }).map((entry) => entry.id)).toEqual(["kinetic-quote"]);
  });
});
