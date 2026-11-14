import { describe, expect, it } from "vitest";

import { BRAND_LOGO_RECIPE, applyBrandStyle, brandKitIsEmpty, brandKitSchema, withBrandLogo, withoutBrandLogo } from "./brand";
import { withCrewcutEnding } from "./ending";
import type { AnyClip } from "./query";
import type { Composition } from "./schema";
import { TEMPLATES, buildTemplate } from "./templates";
import { parseComposition } from "./validate";

const template = () => buildTemplate(TEMPLATES.find((entry) => entry.id === "product-drop") ?? TEMPLATES[0]!, { id: "vid_brand", ratio: "9:16" });
const strings = (composition: Composition) => JSON.stringify(composition.tracks).toLowerCase();

describe("brandKitSchema", () => {
  it("fills defaults and refuses transparent or invalid colours", () => {
    const kit = brandKitSchema.parse({});
    expect(brandKitIsEmpty(kit)).toBe(true);
    expect(kit.autoApply).toEqual({ templates: true, drafts: true, logo: false });
    expect(() => brandKitSchema.parse({ colors: { accent: "#ff000080" } })).toThrow();
    expect(() => brandKitSchema.parse({ colors: { accent: "red" } })).toThrow();
    expect(() => brandKitSchema.parse({ fonts: { display: "Comic Sans" } })).toThrow();
    expect(brandKitIsEmpty(brandKitSchema.parse({ fonts: { body: "Inter" } }))).toBe(false);
  });
});

describe("applyBrandStyle", () => {
  it("replaces the palette and every colour that came from it, keeping transparency", () => {
    const start = template();
    const oldAccent = start.brief.palette.accent.slice(0, 7).toLowerCase();
    expect(strings(start)).toContain(oldAccent);
    // A colour from the palette with alpha, as overlays write it.
    const withAlpha: Composition = JSON.parse(JSON.stringify(start).replace(new RegExp(`"${start.brief.palette.accent.slice(0, 7)}"`, "i"), `"${start.brief.palette.accent.slice(0, 7)}80"`));
    const branded = applyBrandStyle(withAlpha, brandKitSchema.parse({ colors: { accent: "#1A73E8" } }));
    expect(branded.brief.palette.accent).toBe("#1a73e8");
    expect(strings(branded)).not.toContain(oldAccent);
    expect(strings(branded)).toContain("#1a73e8");
    if (strings(withAlpha).includes(`${oldAccent}80`)) expect(strings(branded)).toContain("#1a73e880");
    expect(branded.brief.basedOn).toBe("Brand kit");
    expect(() => parseComposition(branded)).not.toThrow();
  });

  it("swaps fonts that name the old faces, and leaves role references alone", () => {
    const start = template();
    const oldDisplay = start.brief.typePairing.display;
    const target = oldDisplay === "Syne" ? "Inter" : "Syne";
    const branded = applyBrandStyle(start, brandKitSchema.parse({ fonts: { display: target } }));
    expect(branded.brief.typePairing.display).toBe(target);
    expect(JSON.stringify(branded.tracks)).not.toContain(`"font":"${oldDisplay}"`);
    // "display" (a role) still means the display face.
    expect(JSON.stringify(branded.tracks).split('"font":"display"').length).toBe(JSON.stringify(start.tracks).split('"font":"display"').length);
  });

  it("never touches words, names or media addresses, and changes nothing for an empty kit", () => {
    const start = template();
    const accent = start.brief.palette.accent.slice(0, 7);
    const tricky: Composition = JSON.parse(JSON.stringify(start));
    const firstText = tricky.tracks.flatMap((track) => (track.kind === "visual" ? track.clips.flatMap((clip) => clip.layers) : [])).find((layer) => layer.type === "text");
    if (firstText && firstText.type === "text") firstText.text = accent;
    const branded = applyBrandStyle(tricky, brandKitSchema.parse({ colors: { accent: "#123456" } }));
    const after = branded.tracks.flatMap((track) => (track.kind === "visual" ? track.clips.flatMap((clip) => clip.layers) : [])).find((layer) => layer.id === firstText?.id);
    if (after && after.type === "text") expect(after.text).toBe(accent);
    expect(applyBrandStyle(start, brandKitSchema.parse({}))).toBe(start);
  });

  it("maps each old colour once, even when a new colour equals another old one", () => {
    const start = template();
    const { ink, background } = start.brief.palette;
    // Swap ink and background: a chained replacement would turn everything one colour.
    const branded = applyBrandStyle(start, brandKitSchema.parse({ colors: { ink: background.slice(0, 7), background: ink.slice(0, 7) } }));
    expect(branded.brief.palette.ink).toBe(background.slice(0, 7).toLowerCase());
    expect(branded.brief.palette.background).toBe(ink.slice(0, 7).toLowerCase());
    const count = (composition: Composition, color: string) => strings(composition).split(color.slice(0, 7).toLowerCase()).length - 1;
    expect(count(branded, background)).toBe(count(start, ink));
  });
});

describe("withBrandLogo", () => {
  const logo = brandKitSchema.parse({ logo: { assetId: "logo1", aspect: 3, placement: "bottom-left", sizePct: 10, opacity: 0.8 } }).logo!;

  it("puts the logo on its own track, in the corner, until the ending", () => {
    const start = withCrewcutEnding(template());
    const branded = withBrandLogo(start, logo);
    const brandTrack = branded.tracks.find((track) => track.kind === "visual" && track.clips.some((clip) => clip.recipe === BRAND_LOGO_RECIPE))!;
    expect(brandTrack.name).toBe("Brand");
    const clip = brandTrack.clips[0]!;
    expect(clip.startMs).toBe(0);
    const ending = branded.tracks.flatMap((track): AnyClip[] => track.clips).find((entry) => "recipe" in entry && entry.recipe === "crewcut-ending")!;
    expect(clip.startMs + clip.durationMs).toBeLessThanOrEqual(ending.startMs);
    expect(branded.durationMs).toBe(start.durationMs);
    const layer = "layers" in clip ? clip.layers[0]! : null;
    expect(layer).toMatchObject({ type: "image", src: "asset:logo1", transform: { anchorX: 0, anchorY: 1, opacity: 0.8 } });
    // Wider than tall, in proportion to the picture (3:1), in frame percentages.
    const box = layer!.transform;
    expect((box.width! / 100) * branded.width).toBeCloseTo(3 * ((box.height! / 100) * branded.height), 0);
    expect(() => parseComposition(branded)).not.toThrow();
  });

  it("replaces an earlier logo instead of stacking them, and can be removed", () => {
    const start = template();
    const tracks = start.tracks.length;
    const twice = withBrandLogo(withBrandLogo(start, logo), { ...logo, placement: "top-right" });
    expect(twice.tracks.length).toBe(tracks + 1);
    const clips = twice.tracks.flatMap((track): AnyClip[] => track.clips).filter((clip) => "recipe" in clip && clip.recipe === BRAND_LOGO_RECIPE);
    expect(clips).toHaveLength(1);
    const removed = withoutBrandLogo(twice);
    expect(removed.tracks.length).toBe(tracks);
    expect(removed.durationMs).toBe(start.durationMs);
  });

  it("caps very wide logos at 40% of the frame width, keeping their shape", () => {
    const wide = withBrandLogo(template(), { ...logo, aspect: 20, sizePct: 30 });
    const layer = wide.tracks.flatMap((track): AnyClip[] => track.clips).find((clip) => "recipe" in clip && clip.recipe === BRAND_LOGO_RECIPE)!;
    const box = "layers" in layer ? layer.layers[0]!.transform : null;
    expect(box!.width).toBeLessThanOrEqual(40.01);
    expect((box!.width! / 100) * wide.width).toBeCloseTo(20 * ((box!.height! / 100) * wide.height), 0);
  });
});
