import { describe, expect, it } from "vitest";

import { BRAND_LOGO_RECIPE, brandKitSchema, withBrandLogo } from "./brand";
import { withCrewcutEnding } from "./ending";
import type { AnyClip } from "./query";
import type { Composition } from "./schema";
import { TEMPLATES, buildTemplate } from "./templates";
import { thumbnailAtMs, thumbnailChecks, thumbnailComposition, thumbnailMaxMs, thumbnailVariantSchema } from "./thumbnail";
import { parseComposition } from "./validate";

const video = (): Composition => {
  const base = withCrewcutEnding(buildTemplate(TEMPLATES[0]!, { id: "vid_thumb", ratio: "16:9" }));
  const logo = brandKitSchema.parse({ logo: { assetId: "logo1" } }).logo!;
  return withBrandLogo(base, logo);
};
const layersAt = (composition: Composition, atMs: number) =>
  composition.tracks.flatMap((track) => (track.kind === "visual" ? track.clips.filter((clip) => clip.startMs <= atMs && atMs < clip.startMs + clip.durationMs).flatMap((clip) => clip.layers) : []));

describe("thumbnailComposition", () => {
  it("puts the headline over the chosen moment, without captions, and stays valid", () => {
    const start = video();
    const variant = thumbnailVariantSchema.parse({ id: "t1", atMs: 1500, headline: "Golden *hour* trick", style: "bold", position: "bottom" });
    const thumb = thumbnailComposition(start, variant);
    expect(thumb.tracks.some((track) => track.kind === "caption")).toBe(false);
    const headline = layersAt(thumb, 1500).find((layer) => layer.id === "thumb-headline");
    expect(headline).toMatchObject({ type: "text", text: "Golden *hour* trick" });
    expect(layersAt(thumb, 1500).some((layer) => layer.id === "thumb-scrim")).toBe(true);
    expect(() => parseComposition(thumb)).not.toThrow();
    // The video itself is untouched.
    expect(start.tracks.some((track) => track.name === "Thumbnail")).toBe(false);
  });

  it("keeps or drops the brand logo", () => {
    const start = video();
    const keep = thumbnailComposition(start, thumbnailVariantSchema.parse({ id: "a", atMs: 1000, logo: true }));
    const drop = thumbnailComposition(start, thumbnailVariantSchema.parse({ id: "b", atMs: 1000, logo: false }));
    const hasLogo = (composition: Composition) => composition.tracks.some((track) => track.kind === "visual" && track.clips.some((clip) => clip.recipe === BRAND_LOGO_RECIPE));
    expect(hasLogo(keep)).toBe(true);
    expect(hasLogo(drop)).toBe(false);
  });

  it("never shows the Crewcut ending, and a picture-only variant adds nothing", () => {
    const start = video();
    expect(thumbnailAtMs(start, { atMs: 10_000_000 })).toBe(thumbnailMaxMs(start));
    const ending = start.tracks.flatMap((track): AnyClip[] => track.clips).find((clip) => "recipe" in clip && clip.recipe === "crewcut-ending")!;
    expect(thumbnailMaxMs(start)).toBeLessThan(ending.startMs);
    const plain = thumbnailComposition(start, thumbnailVariantSchema.parse({ id: "p", atMs: 900, headline: "" }));
    expect(plain.tracks.length).toBe(start.tracks.filter((track) => track.kind !== "caption").length);
  });

  it("boxed headlines pick a readable text colour for the accent box", () => {
    const start = video();
    const thumb = thumbnailComposition(start, thumbnailVariantSchema.parse({ id: "x", atMs: 1200, headline: "Try this", style: "boxed", position: "top" }));
    const headline = layersAt(thumb, 1200).find((layer) => layer.id === "thumb-headline");
    expect(headline?.type === "text" && headline.style.background).toBe(start.brief.palette.accent.slice(0, 7));
    expect(["#ffffff", "#0d0d0f"]).toContain(headline?.type === "text" ? headline.style.color : "");
    expect(layersAt(thumb, 1200).some((layer) => layer.id === "thumb-scrim")).toBe(false);
  });
});

describe("thumbnailChecks", () => {
  it("flags long headlines", () => {
    const short = thumbnailChecks(thumbnailVariantSchema.parse({ id: "s", atMs: 0, headline: "Stop doing this" }));
    expect(short.every((check) => check.ok)).toBe(true);
    const long = thumbnailChecks(thumbnailVariantSchema.parse({ id: "l", atMs: 0, headline: "Seven things nobody tells you about light" }));
    expect(long.some((check) => !check.ok)).toBe(true);
  });
});
