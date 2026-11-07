import { describe, expect, it } from "vitest";

import { validateComposition } from "../validate";
import { buildTemplate, getTemplate } from "./index";
import { closestRatioOf, compositionAssetIds, fillTemplateSlots, layersInOrder, markTemplateSlots, remapAssetRefs, templateSlotsOf } from "./data";

const base = () => {
  const template = getTemplate("golden-hour");
  if (!template) throw new Error("golden-hour missing");
  return buildTemplate(template, { id: "vid_data", ratio: "9:16", values: { "photo-1": "asset:ast_one", "photo-2": "asset:ast_two" } });
};

const find = (composition: ReturnType<typeof base>, layerId: string) => layersInOrder(composition).find((entry) => entry.layer.id === layerId);

describe("templates as data", () => {
  it("reads the slots a built template declares, in timeline order", () => {
    const slots = templateSlotsOf(base());
    expect(slots[0]?.id).toBe("photo-1");
    expect(slots.map((slot) => slot.id)).toEqual(expect.arrayContaining(["title", "place", "outro", "photo-5"]));
    expect(slots.find((slot) => slot.id === "title")).toMatchObject({ kind: "text" });
    expect(slots.find((slot) => slot.id === "photo-1")).toMatchObject({ kind: "photo", default: "asset:ast_one" });
  });

  it("marks only the chosen layers, named and slugged from their labels", () => {
    const composition = base();
    const title = find(composition, "title") ?? layersInOrder(composition).find((entry) => entry.layer.slot === "title");
    const photo = find(composition, "open-photo");
    if (!title || !photo) throw new Error("layers missing");
    const { composition: marked, slots } = markTemplateSlots(composition, [
      { clipId: photo.clip.id, layerId: photo.layer.id, label: "Hero photo" },
      { clipId: title.clip.id, layerId: title.layer.id, label: "Hero photo" },
    ]);
    // Same label, different kinds: two slots with distinct ids.
    expect(slots.map((slot) => [slot.id, slot.kind])).toEqual([
      ["hero-photo", "photo"],
      ["hero-photo-2", "text"],
    ]);
    const slotted = layersInOrder(marked).filter((entry) => entry.layer.slot);
    expect(slotted).toHaveLength(2);
    expect(slotted.every((entry) => entry.layer.name === "Hero photo")).toBe(true);
    expect(validateComposition(marked).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("fills text and media slots and ignores unusable values", () => {
    const composition = base();
    const filled = fillTemplateSlots(composition, { title: "Lisbon, *slowly*", "photo-1": "asset:ast_new", "photo-2": "javascript:alert(1)", outro: "   " });
    const slots = templateSlotsOf(filled);
    expect(slots.find((slot) => slot.id === "title")?.default).toBe("Lisbon, *slowly*");
    expect(slots.find((slot) => slot.id === "photo-1")?.default).toBe("asset:ast_new");
    expect(slots.find((slot) => slot.id === "photo-2")?.default).toBe("asset:ast_two");
    expect(slots.find((slot) => slot.id === "outro")?.default).toBe(templateSlotsOf(composition).find((slot) => slot.id === "outro")?.default);
  });

  it("lists and remaps the media a composition uses", () => {
    const composition = base();
    expect(compositionAssetIds(composition)).toEqual(expect.arrayContaining(["ast_one", "ast_two"]));
    const remapped = remapAssetRefs(composition, { ast_one: "ast_copy" });
    expect(compositionAssetIds(remapped)).toContain("ast_copy");
    expect(compositionAssetIds(remapped)).not.toContain("ast_one");
    expect(compositionAssetIds(remapped)).toContain("ast_two");
  });

  it("picks the closest format", () => {
    expect(closestRatioOf(["9:16", "16:9"], "4:5")).toBe("9:16");
    expect(closestRatioOf(["9:16", "16:9"], "21:9")).toBe("16:9");
    expect(closestRatioOf(["1:1"], "1:1")).toBe("1:1");
    expect(closestRatioOf([], "1:1")).toBeNull();
  });
});
