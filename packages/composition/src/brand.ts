import { z } from "zod";

import { crewcutEndingStartMs, isCrewcutEnding } from "./ending";
import { FONT_FAMILIES, type FontFamily } from "./fonts";
import { addClip, addTrack, deleteClips } from "./ops";
import { type Composition, type Palette, hexColorSchema } from "./schema";

/**
 * A workspace's brand: colours, fonts and logo, applied to a video in one
 * step. Colours replace the video's palette AND every colour in it that came
 * from that palette (templates and drafts write colours out literally), so a
 * template's orange becomes the brand's accent wherever it was used. Fonts
 * replace the display and body faces the same way. The logo sits on its own
 * overlay track, in a corner, until the Crewcut ending.
 */

export const BRAND_COLOR_ROLES = ["background", "surface", "ink", "muted", "accent", "accent2"] as const;
export type BrandColorRole = (typeof BRAND_COLOR_ROLES)[number];
export const BRAND_LOGO_PLACEMENTS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export const BRAND_LOGO_RECIPE = "brand-logo";

const sixDigitHex = hexColorSchema.refine((value) => value.length === 7, "Use #rrggbb (no transparency)");

export const brandKitSchema = z.object({
  colors: z.object(Object.fromEntries(BRAND_COLOR_ROLES.map((role) => [role, sixDigitHex.optional()])) as Record<BrandColorRole, z.ZodOptional<typeof sixDigitHex>>).default({}),
  fonts: z.object({ display: z.enum(FONT_FAMILIES).optional(), body: z.enum(FONT_FAMILIES).optional() }).default({}),
  logo: z
    .object({
      assetId: z.string().min(1).max(64),
      /** Width ÷ height of the picture, so the box fits it. */
      aspect: z.number().min(0.05).max(20).default(1),
      placement: z.enum(BRAND_LOGO_PLACEMENTS).default("top-right"),
      /** Logo height as % of the frame's short side. */
      sizePct: z.number().min(4).max(30).default(10),
      opacity: z.number().min(0.2).max(1).default(0.9),
    })
    .optional(),
  /** Apply on its own to new template videos and the crew's drafts. */
  autoApply: z.object({ templates: z.boolean().default(true), drafts: z.boolean().default(true), logo: z.boolean().default(false) }).prefault({}),
});
export type BrandKit = z.infer<typeof brandKitSchema>;
export type BrandKitInput = z.input<typeof brandKitSchema>;

export function brandKitIsEmpty(kit: BrandKit): boolean {
  return !Object.values(kit.colors).some(Boolean) && !kit.fonts.display && !kit.fonts.body && !kit.logo;
}

/** Keys whose strings are words or addresses, never colours or fonts. */
const SKIP_KEYS = new Set(["text", "name", "label", "src", "alt", "code", "id", "title", "language", "lineId", "beatId", "assetId", "recipe"]);
const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** Rewrites colour and font strings inside tracks, in one pass (a replaced value is never replaced again). */
function rewrite(value: unknown, colors: ReadonlyMap<string, string>, fonts: ReadonlyMap<string, string>, key = ""): unknown {
  if (typeof value === "string") {
    if (SKIP_KEYS.has(key)) return value;
    if (HEX.test(value)) {
      const replacement = colors.get(value.slice(0, 7).toLowerCase());
      // Keep any transparency the original had.
      return replacement ? `${replacement}${value.slice(7)}` : value;
    }
    if ((key === "font" || key === "fontFamily") && fonts.has(value)) return fonts.get(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => rewrite(item, colors, fonts, key));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(value)) out[name] = rewrite(child, colors, fonts, name);
    return out;
  }
  return value;
}

/** The video's palette and fonts swapped for the brand's, everywhere they were used. */
export function applyBrandStyle(composition: Composition, kit: BrandKit): Composition {
  const palette = { ...composition.brief.palette };
  const colors = new Map<string, string>();
  // Ink and background first: if two roles shared a colour, the more visible one decides.
  for (const role of ["ink", "background", "accent", "surface", "muted", "accent2"] as const) {
    const next = kit.colors[role];
    if (!next) continue;
    const previous = palette[role];
    if (previous && previous.slice(0, 7).toLowerCase() !== next.toLowerCase() && !colors.has(previous.slice(0, 7).toLowerCase())) {
      colors.set(previous.slice(0, 7).toLowerCase(), next.toLowerCase());
    }
    (palette as Record<string, string>)[role] = next.toLowerCase();
  }
  const typePairing = { ...composition.brief.typePairing };
  const fonts = new Map<string, FontFamily>();
  for (const role of ["display", "body"] as const) {
    const next = kit.fonts[role];
    if (!next) continue;
    if (typePairing[role] !== next && !fonts.has(typePairing[role])) fonts.set(typePairing[role], next);
    typePairing[role] = next;
  }
  if (colors.size === 0 && fonts.size === 0 && JSON.stringify(palette) === JSON.stringify(composition.brief.palette) && JSON.stringify(typePairing) === JSON.stringify(composition.brief.typePairing)) {
    return composition;
  }
  return {
    ...composition,
    brief: { ...composition.brief, palette: palette as Palette, typePairing, basedOn: "Brand kit" },
    tracks: rewrite(composition.tracks, colors, fonts) as Composition["tracks"],
  };
}

/** Removes the brand logo clip(s); empty brand tracks go too. */
export function withoutBrandLogo(composition: Composition): Composition {
  const ids = composition.tracks.flatMap((track) => (track.kind === "visual" ? track.clips.filter((clip) => clip.recipe === BRAND_LOGO_RECIPE).map((clip) => clip.id) : []));
  if (ids.length === 0) return composition;
  const mainTrackId = composition.tracks.find((track) => track.kind === "visual")?.id;
  const tracksWithLogo = new Set(
    composition.tracks.filter((track) => track.kind === "visual" && track.id !== mainTrackId && track.clips.some((clip) => clip.recipe === BRAND_LOGO_RECIPE)).map((track) => track.id),
  );
  const next = deleteClips(composition, { clipIds: ids });
  return { ...next, tracks: next.tracks.filter((track) => !(tracksWithLogo.has(track.id) && track.clips.length === 0)) };
}

/**
 * The logo in a corner on its own track, from the start until the Crewcut
 * ending (or the end). `assetId` is the logo's asset in this video.
 */
export function withBrandLogo(composition: Composition, logo: NonNullable<BrandKit["logo"]> & { assetId: string }): Composition {
  const base = withoutBrandLogo(composition);
  const end = base.tracks.some((track) => track.kind === "visual" && track.clips.some((clip) => isCrewcutEnding(clip))) ? crewcutEndingStartMs(base) : base.durationMs;
  if (end <= 0) return base;
  const short = Math.min(base.width, base.height);
  const heightPx = (logo.sizePct / 100) * short;
  const widthPx = Math.min(heightPx * logo.aspect, base.width * 0.4);
  const boxHeightPx = widthPx < heightPx * logo.aspect ? widthPx / logo.aspect : heightPx;
  const marginPx = short * 0.045;
  const right = logo.placement.endsWith("right");
  const bottom = logo.placement.startsWith("bottom");
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  const { composition: withTrack, trackId } = addTrack(base, { kind: "visual", name: "Brand" });
  return addClip(withTrack, {
    trackId,
    clip: {
      id: "brand-logo",
      name: "Logo",
      recipe: BRAND_LOGO_RECIPE,
      startMs: 0,
      durationMs: Math.round(end),
      layers: [
        {
          id: "brand-logo-image",
          type: "image",
          name: "Logo",
          src: `asset:${logo.assetId}`,
          fit: "contain",
          alt: "Logo",
          transform: {
            x: round(right ? 100 - (marginPx / base.width) * 100 : (marginPx / base.width) * 100),
            y: round(bottom ? 100 - (marginPx / base.height) * 100 : (marginPx / base.height) * 100),
            width: round((widthPx / base.width) * 100),
            height: round((boxHeightPx / base.height) * 100),
            anchorX: right ? 1 : 0,
            anchorY: bottom ? 1 : 0,
            opacity: logo.opacity,
          },
        },
      ],
    },
  }).composition;
}
