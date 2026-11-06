import { clipEndMs } from "./query";
import { type Composition, type EasingSpec, type Keyframe, type LayerInput, type Track, type VisualClip, visualClipSchema } from "./schema";
import { normalizeComposition } from "./validate";

/**
 * The Crewcut ending: a short branded card at the end of the main track (like
 * CapCut's default ending). It is an ordinary clip built from ordinary layers,
 * so it previews, exports and undoes like everything else, and removing it is
 * just deleting the clip.
 *
 * The animation is the logo's own: the C draws in, its lower half is cut loose
 * and slips sideways (the jump cut), then the wordmark rises letter by letter.
 */

export const CREWCUT_ENDING_RECIPE = "crewcut-ending";
export const CREWCUT_ENDING_MS = 2600;

const INK = "#0D0D0F";
const PAPER = "#F5F3EE";
const CUT = "#FF5B2E";

const svg = (path: string, color: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${path}" fill="none" stroke="${color}" stroke-width="17"/></svg>`)}`;
const UPPER = svg("M74.51 29.43 A32 32 0 0 0 18 50", PAPER);
const LOWER = svg("M18 50 A32 32 0 0 0 74.51 70.57", CUT);

export function isCrewcutEnding(clip: { recipe?: string | undefined }): boolean {
  return clip.recipe === CREWCUT_ENDING_RECIPE;
}

function mainTrack(composition: Composition): Track | undefined {
  return composition.tracks.find((track) => track.kind === "visual");
}

export function hasCrewcutEnding(composition: Composition): boolean {
  return composition.tracks.some((track) => track.kind === "visual" && track.clips.some((clip) => isCrewcutEnding(clip)));
}

/** Where the ending goes: after the last picture or caption (music may run on under it). */
export function crewcutEndingStartMs(composition: Composition): number {
  let end = 0;
  for (const track of composition.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) if (!("recipe" in clip && isCrewcutEnding(clip))) end = Math.max(end, clipEndMs(clip));
  }
  return Math.round(end);
}

const kf = (atMs: number, value: number, easing: EasingSpec = "move"): Keyframe => ({ atMs, value, easing });

/** The ending clip for a frame size, starting at `startMs`: the side-by-side lockup, centred. */
export function crewcutEndingClip(composition: Pick<Composition, "width" | "height">, startMs: number, id = "crewcut-ending"): VisualClip {
  const short = Math.min(composition.width, composition.height);
  // Design px are measured against a 1080 short side (as text sizes are), so the
  // lockup is the same size relative to the frame's short side in every ratio.
  const designW = (1080 * composition.width) / short;
  const designH = (1080 * composition.height) / short;

  const font = 84;
  const mark = Math.round(font * 1.87);
  // The C's box has empty space on its open side, so the gap is tighter than it looks.
  const gap = Math.round(font * 0.28);
  const wordWidth = font * 3.55;
  const left = (designW - (mark + gap + wordWidth)) / 2;
  const markX = ((left + mark / 2) / designW) * 100;
  const wordX = ((left + mark + gap) / designW) * 100;
  const box = { x: markX, y: 50, width: (mark / designW) * 100, height: (mark / designH) * 100 };

  const slipAt = 760;
  const slip = (share: number): Keyframe[] => [kf(slipAt, 0, "hold"), kf(slipAt + 560, Math.round(mark * share * 10) / 10, "spring-snappy")];
  const layers: LayerInput[] = [
    {
      id: `${id}-upper`,
      type: "image",
      name: "Logo (top)",
      src: UPPER,
      fit: "contain",
      alt: "Crewcut logo",
      transform: box,
      // The C draws from its top tip round to the left…
      keyframes: { clipLeft: [kf(120, 100, "hold"), kf(470, 0, { bezier: [0.3, 0, 0.2, 1] })] },
    } as LayerInput,
    {
      id: `${id}-lower`,
      type: "image",
      name: "Logo (cut half)",
      src: LOWER,
      fit: "contain",
      alt: "",
      transform: box,
      // …on round to the bottom, then this half is cut loose and slips (the logo's 6/4 offset).
      keyframes: {
        clipRight: [kf(400, 100, "hold"), kf(740, 0, { bezier: [0.2, 0, 0.2, 1] })],
        offsetX: slip(0.06),
        offsetY: slip(0.04),
      },
    } as LayerInput,
    {
      id: `${id}-word`,
      type: "text",
      name: "Wordmark",
      text: "crewcut",
      startMs: 880,
      style: { font: "Geist", size: font, weight: 600, color: PAPER, align: "left", tracking: -0.045, leading: 1, maxWidth: 90 },
      transform: { x: wordX, y: 50, anchorX: 0, anchorY: 0.5 },
      animation: { unit: "char", preset: "mask-rise", delayMs: 0, staggerMs: 34, durationMs: 560, easing: "spring-smooth" },
    } as LayerInput,
  ];
  return visualClipSchema.parse({
    id,
    name: "Crewcut ending",
    startMs,
    durationMs: CREWCUT_ENDING_MS,
    background: INK,
    layers,
    transitionIn: { type: "crossfade", durationMs: 420, direction: "left", easing: "standard" },
    recipe: CREWCUT_ENDING_RECIPE,
    lineIds: [],
    timing: "manual",
  });
}

/** Adds the ending at the end of the main track (once). */
export function withCrewcutEnding(composition: Composition): Composition {
  const track = mainTrack(composition);
  if (!track || hasCrewcutEnding(composition) || crewcutEndingStartMs(composition) <= 0) return composition;
  const next = structuredClone(composition);
  const target = mainTrack(next);
  if (!target || target.kind !== "visual") return composition;
  target.clips.push(crewcutEndingClip(next, crewcutEndingStartMs(next)));
  return normalizeComposition(next);
}

export function withoutCrewcutEnding(composition: Composition): Composition {
  if (!hasCrewcutEnding(composition)) return composition;
  const next = structuredClone(composition);
  for (const track of next.tracks) if (track.kind === "visual") track.clips = track.clips.filter((clip) => !isCrewcutEnding(clip));
  return normalizeComposition(next);
}
