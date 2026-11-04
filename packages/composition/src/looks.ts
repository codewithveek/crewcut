import { createSeededRandom } from "@proofcut/motion";

import { type StyleFingerprint, fingerprintFromBrief, styleSimilarity } from "./fingerprint";
import type { FontFamily } from "./fonts";
import {
  type ArtDirectionBrief,
  LAYOUT_GRIDS,
  MOTION_SIGNATURES,
  type Palette,
  type TransitionType,
  artDirectionBriefSchema,
} from "./schema";

/**
 * Video presets: Cutroom's four looks, re-expressed as art direction briefs.
 * A preset is a starting point — the motion director still varies layout and
 * motion within it, and the user can edit every field.
 */
export const VIDEO_PRESETS: Record<string, { label: string; summary: string; brief: ArtDirectionBrief }> = {
  editorial: {
    label: "Editorial",
    summary: "Warm paper, confident sans, orange accent; magazine pacing.",
    brief: artDirectionBriefSchema.parse({
      mood: "Warm magazine spread — confident, crafted, calm",
      palette: { background: "#efeee9", surface: "#ffffff", ink: "#161513", muted: "#6f6c64", accent: "#ff5a1f" },
      typePairing: { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans", mono: "Geist Mono" },
      layoutGrid: "editorial-columns",
      motionSignature: "spring-soft",
      transitionSet: ["blur-crossfade", "wipe"],
      pacing: "brisk",
      basedOn: "preset:editorial",
    }),
  },
  studio: {
    label: "Studio",
    summary: "Near-black studio glow, violet accent, measured pacing.",
    brief: artDirectionBriefSchema.parse({
      mood: "Dark product studio with a soft violet glow",
      palette: { background: "#09090c", surface: "#16161c", ink: "#f5f5f7", muted: "#9a9aa6", accent: "#7c5cff" },
      typePairing: { display: "Inter", body: "Inter", mono: "Geist Mono" },
      layoutGrid: "centered",
      motionSignature: "spring-snappy",
      transitionSet: ["blur-crossfade", "scale-fade"],
      pacing: "measured",
      basedOn: "preset:studio",
    }),
  },
  graphic: {
    label: "Graphic",
    summary: "White grid, black type, electric blue; hard cuts and slabs.",
    brief: artDirectionBriefSchema.parse({
      mood: "Swiss poster — bold, flat, rhythmic",
      palette: { background: "#fafafa", surface: "#ffffff", ink: "#0a0a0a", muted: "#6b6b6b", accent: "#2f5bff" },
      typePairing: { display: "Inter Tight", body: "Inter Tight", mono: "Geist Mono" },
      layoutGrid: "left-rail",
      motionSignature: "staccato",
      transitionSet: ["cut", "push", "wipe"],
      pacing: "brisk",
      basedOn: "preset:graphic",
    }),
  },
  cinematic: {
    label: "Cinematic",
    summary: "Deep black, gold accent, slow focus pulls.",
    brief: artDirectionBriefSchema.parse({
      mood: "Night-time film title sequence",
      palette: { background: "#060607", surface: "#111113", ink: "#ecebe6", muted: "#8b8a85", accent: "#e8c27a" },
      typePairing: { display: "Geist", body: "Geist", mono: "Geist Mono" },
      layoutGrid: "full-bleed",
      motionSignature: "cinematic-slow",
      transitionSet: ["blur-crossfade", "zoom-through"],
      pacing: "slow",
      basedOn: "preset:cinematic",
    }),
  },
};

interface PaletteFamily {
  name: string;
  mood: string;
  palette: Omit<Palette, "positive" | "negative">;
}

/** Curated palettes the freeform brief generator draws from. */
export const PALETTE_FAMILIES: readonly PaletteFamily[] = [
  { name: "lab-notebook", mood: "Lab notebook — precise, airy, quietly technical", palette: { background: "#f4f1ea", surface: "#fffdf8", ink: "#1d1c1a", muted: "#7a756b", accent: "#2b6cff", accent2: "#ff7a1a" } },
  { name: "neon-terminal", mood: "Neon terminal at 2am — electric, focused", palette: { background: "#07090d", surface: "#10141b", ink: "#e6f1ff", muted: "#6b7a90", accent: "#3dffa2", accent2: "#36c5ff" } },
  { name: "sunset-ink", mood: "Sunset over ink — warm drama, serif confidence", palette: { background: "#140f12", surface: "#21181c", ink: "#fbeee6", muted: "#a08b84", accent: "#ff8a5b", accent2: "#ffd166" } },
  { name: "mint-grid", mood: "Mint blueprint — clean, optimistic engineering", palette: { background: "#eaf6f1", surface: "#ffffff", ink: "#0f2a22", muted: "#5d7a70", accent: "#00a37a", accent2: "#0b6bff" } },
  { name: "ultraviolet", mood: "Ultraviolet keynote — big type, bold glow", palette: { background: "#0b0614", surface: "#170e26", ink: "#f3ecff", muted: "#9b8cb5", accent: "#a855ff", accent2: "#ff4fd8" } },
  { name: "newsprint", mood: "Newsprint explainer — editorial and factual", palette: { background: "#f2f0eb", surface: "#ffffff", ink: "#111111", muted: "#666259", accent: "#d7362b" } },
  { name: "ocean-depth", mood: "Ocean depth — calm, deep, trustworthy", palette: { background: "#04121c", surface: "#0b2233", ink: "#e3f2fb", muted: "#7a98ab", accent: "#38bdf8", accent2: "#5eead4" } },
  { name: "citrus-pop", mood: "Citrus pop — playful, high energy", palette: { background: "#fff8e6", surface: "#ffffff", ink: "#1b1300", muted: "#7c6a3b", accent: "#ff5e00", accent2: "#00b37e" } },
  { name: "graphite", mood: "Graphite minimal — understated and premium", palette: { background: "#18181b", surface: "#232327", ink: "#f4f4f5", muted: "#a1a1aa", accent: "#f97316", accent2: "#fafafa" } },
  { name: "forest-moss", mood: "Forest field guide — grounded and natural", palette: { background: "#101810", surface: "#1a261a", ink: "#eef4e6", muted: "#93a38a", accent: "#b6e35a", accent2: "#f4c95d" } },
  { name: "rose-quartz", mood: "Rose quartz — soft, human, approachable", palette: { background: "#fbf1f0", surface: "#ffffff", ink: "#2a1418", muted: "#8d6b70", accent: "#e8436b", accent2: "#6d5dfc" } },
  { name: "solar-flare", mood: "Solar flare — urgent, cinematic contrast", palette: { background: "#0d0a06", surface: "#1c150c", ink: "#fff6e8", muted: "#a8977c", accent: "#ffb21a", accent2: "#ff4b2b" } },
];

export const TYPE_PAIRINGS: ReadonlyArray<{ display: FontFamily; body: FontFamily; mono: FontFamily; character: string }> = [
  { display: "Inter Tight", body: "Inter", mono: "JetBrains Mono", character: "neutral and tight" },
  { display: "Space Grotesk", body: "Inter", mono: "JetBrains Mono", character: "technical and quirky" },
  { display: "Fraunces", body: "DM Sans", mono: "Geist Mono", character: "warm serif headlines" },
  { display: "Instrument Serif", body: "Inter", mono: "Geist Mono", character: "elegant editorial" },
  { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans", mono: "Geist Mono", character: "friendly geometric" },
  { display: "Geist", body: "Geist", mono: "Geist Mono", character: "crisp product UI" },
  { display: "DM Sans", body: "DM Sans", mono: "JetBrains Mono", character: "soft and approachable" },
  { display: "Space Grotesk", body: "DM Sans", mono: "Geist Mono", character: "playful tech" },
];

const TRANSITION_SETS: readonly TransitionType[][] = [
  ["blur-crossfade", "scale-fade"],
  ["push", "wipe"],
  ["cut", "push"],
  ["zoom-through", "blur-crossfade"],
  ["slide", "crossfade"],
  ["wipe", "cut", "scale-fade"],
];

export interface GenerateBriefOptions {
  seed: number;
  /** Fingerprints of recent videos to steer away from (variety guard). */
  avoid?: readonly StyleFingerprint[];
  /** Brand kit locks: kept as-is, everything else varies. */
  lockedPalette?: Partial<Palette>;
  lockedType?: { display?: FontFamily; body?: FontFamily; mono?: FontFamily };
  mood?: string;
  preset?: keyof typeof VIDEO_PRESETS;
  pacing?: ArtDirectionBrief["pacing"];
  candidates?: number;
}

/**
 * Writes a fresh art direction brief deterministically from a seed, choosing
 * among `candidates` options the one least like the recent videos. Used when
 * no model is connected and as the motion director's starting suggestion.
 */
export function generateArtDirectionBrief(options: GenerateBriefOptions): ArtDirectionBrief {
  const random = createSeededRandom(options.seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const base = options.preset ? VIDEO_PRESETS[options.preset]?.brief : undefined;
  const candidates: ArtDirectionBrief[] = [];
  for (let index = 0; index < (options.candidates ?? 8); index += 1) {
    const family = pick(PALETTE_FAMILIES);
    const pairing = pick(TYPE_PAIRINGS);
    const palette = { ...(base?.palette ?? family.palette), ...options.lockedPalette };
    candidates.push(
      artDirectionBriefSchema.parse({
        mood: options.mood ?? base?.mood ?? family.mood,
        palette,
        typePairing: {
          display: options.lockedType?.display ?? (base ? base.typePairing.display : pairing.display),
          body: options.lockedType?.body ?? (base ? base.typePairing.body : pairing.body),
          mono: options.lockedType?.mono ?? (base ? base.typePairing.mono : pairing.mono),
        },
        layoutGrid: pick(LAYOUT_GRIDS),
        motionSignature: base && index === 0 ? base.motionSignature : pick(MOTION_SIGNATURES),
        transitionSet: base && index === 0 ? base.transitionSet : pick(TRANSITION_SETS),
        pacing: options.pacing ?? base?.pacing ?? pick(["brisk", "measured", "measured", "slow"] as const),
        notes: `Type: ${pairing.character}.`,
        ...(base?.basedOn ? { basedOn: base.basedOn } : {}),
      }),
    );
  }
  const avoid = options.avoid ?? [];
  if (avoid.length === 0) return candidates[0] as ArtDirectionBrief;
  let best = candidates[0] as ArtDirectionBrief;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const fingerprint = fingerprintFromBrief(candidate);
    const worst = Math.max(...avoid.map((other) => styleSimilarity(fingerprint, other).score));
    if (worst < bestScore) {
      bestScore = worst;
      best = candidate;
    }
  }
  return best;
}
