import { z } from "zod";

import { withoutBrandLogo } from "./brand";
import { crewcutEndingStartMs, hasCrewcutEnding } from "./ending";
import { addClip, addTrack } from "./ops";
import type { Composition } from "./schema";

/**
 * Thumbnails made from the video itself: one moment of it, a short headline
 * on top in one of a few proven styles, the brand logo kept or left off.
 * `thumbnailComposition` returns a composition whose frame at `atMs` IS the
 * thumbnail, so the editor's preview and the exported picture are the same
 * render.
 */

export const THUMBNAIL_STYLES = ["bold", "boxed", "outline", "minimal"] as const;
export const THUMBNAIL_POSITIONS = ["top", "center", "bottom"] as const;
export type ThumbnailStyle = (typeof THUMBNAIL_STYLES)[number];
export type ThumbnailPosition = (typeof THUMBNAIL_POSITIONS)[number];

export const thumbnailVariantSchema = z.object({
  id: z.string().min(1).max(40),
  /** The moment of the video behind the headline. */
  atMs: z.number().min(0),
  /** Wrap words in *stars* to colour them. Empty = the picture alone. */
  headline: z.string().max(60).default(""),
  style: z.enum(THUMBNAIL_STYLES).default("bold"),
  position: z.enum(THUMBNAIL_POSITIONS).default("bottom"),
  /** Keep the brand logo (when the video has one). */
  logo: z.boolean().default(true),
});
export type ThumbnailVariant = z.infer<typeof thumbnailVariantSchema>;
export type ThumbnailVariantInput = z.input<typeof thumbnailVariantSchema>;

export function headlineWords(headline: string): number {
  return headline.replace(/\*/g, "").split(/\s+/).filter(Boolean).length;
}

/** The last moment a thumbnail can show: before the Crewcut ending. */
export function thumbnailMaxMs(composition: Composition): number {
  const end = hasCrewcutEnding(composition) ? crewcutEndingStartMs(composition) : composition.durationMs;
  return Math.max(0, Math.round(end - 1000 / composition.fps));
}

/** Where the thumbnail's frame is, clamped into the video. */
export function thumbnailAtMs(composition: Composition, variant: Pick<ThumbnailVariant, "atMs">): number {
  return Math.min(Math.max(0, Math.round(variant.atMs)), thumbnailMaxMs(composition));
}

/** Black or white, whichever reads better on `hex`. */
function textOn(hex: string): string {
  const value = hex.replace("#", "").slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(value.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#0d0d0f" : "#ffffff";
}

/** Design px against a 1080 px short side: big for a word or two, smaller as it grows. */
function headlineSize(words: number, style: ThumbnailStyle): number {
  const base = words <= 2 ? 200 : words <= 4 ? 160 : words <= 6 ? 128 : 100;
  return style === "minimal" ? Math.round(base * 0.7) : base;
}

export function thumbnailComposition(composition: Composition, variant: ThumbnailVariant): Composition {
  const atMs = thumbnailAtMs(composition, variant);
  // Captions belong to the video, not its thumbnail.
  let next: Composition = { ...composition, tracks: composition.tracks.filter((track) => track.kind !== "caption") };
  if (!variant.logo) next = withoutBrandLogo(next);
  const text = variant.headline.trim();
  if (!text) return next;

  const { palette } = next.brief;
  const accent = palette.accent.slice(0, 7);
  const frame = 1000 / next.fps;
  const y = variant.position === "top" ? 7 : variant.position === "center" ? 50 : 93;
  const anchorY = variant.position === "top" ? 0 : variant.position === "center" ? 0.5 : 1;
  const words = headlineWords(text);
  const size = headlineSize(words, variant.style);
  const uppercase = variant.style !== "minimal";
  const style =
    variant.style === "boxed"
      ? { color: textOn(accent), background: accent, padding: 28, radius: 18 }
      : variant.style === "outline"
        ? { color: accent, accentColor: "#ffffff", strokeColor: "#000000", strokeWidth: 12 }
        : { color: "#ffffff", accentColor: accent, strokeColor: "#000000", strokeWidth: variant.style === "minimal" ? 0 : 10 };
  const scrim =
    variant.style === "boxed"
      ? null
      : variant.position === "center"
        ? ("#00000059" as const)
        : {
            gradient: {
              kind: "linear" as const,
              angle: 180,
              stops:
                variant.position === "top"
                  ? [
                      { color: "#000000b3", at: 0 },
                      { color: "#00000000", at: 1 },
                    ]
                  : [
                      { color: "#00000000", at: 0 },
                      { color: "#000000b3", at: 1 },
                    ],
            },
          };
  const layers: Array<Record<string, unknown>> = [];
  if (scrim) {
    layers.push({
      id: "thumb-scrim",
      type: "shape",
      name: "Shade",
      shape: "rect",
      fill: scrim,
      transform: { x: 50, y: variant.position === "center" ? 50 : variant.position === "top" ? 0 : 100, anchorX: 0.5, anchorY: variant.position === "top" ? 0 : variant.position === "center" ? 0.5 : 1, width: 100, height: variant.position === "center" ? 100 : 55 },
    });
  }
  layers.push({
    id: "thumb-headline",
    type: "text",
    name: "Headline",
    text,
    style: { font: "display", size, weight: 900, align: "center", uppercase, maxWidth: 88, leading: 1, tracking: -0.02, ...style },
    transform: { x: 50, y, anchorX: 0.5, anchorY },
  });
  const { composition: withTrack, trackId } = addTrack(next, { kind: "visual", name: "Thumbnail" });
  return addClip(withTrack, {
    trackId,
    clip: { id: "thumbnail-overlay", name: "Thumbnail", startMs: Math.max(0, atMs - frame), durationMs: Math.ceil(frame * 3), layers },
  }).composition;
}

/**
 * Rules of thumb for a thumbnail, used until the channel has enough history
 * to measure what works for it. Each check says what it found.
 */
export function thumbnailChecks(variant: ThumbnailVariant): Array<{ ok: boolean; note: string }> {
  const words = headlineWords(variant.headline);
  return [
    words === 0 ? { ok: true, note: "Picture only: works when the frame tells the story on its own." } : words <= 5 ? { ok: true, note: `${words} word${words === 1 ? "" : "s"}: readable at phone size.` } : { ok: false, note: `${words} words: thumbnails read best with 5 or fewer.` },
    variant.headline.length > 40 ? { ok: false, note: "Long headline: it will be small on a phone." } : { ok: true, note: "Short enough to stay large." },
    { ok: variant.style !== "minimal" || words <= 3, note: variant.style === "minimal" && words > 3 ? "Minimal style with many words gets small; try Bold." : "Style keeps the words high-contrast." },
  ];
}
