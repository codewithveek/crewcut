import type { ArtDirectionBrief, Composition } from "./schema";
import { visualTracks } from "./query";

/**
 * Style fingerprint and variety guard: each video gets a fingerprint of its
 * palette, type pairing, layout grid, motion signature, transitions and
 * pacing. QA compares it with the workspace's recent videos and flags a video
 * that is too close, unless the user asked for consistency.
 */
export interface StyleFingerprint {
  palette: { background: string; accent: string; ink: string; surface: string };
  typePairing: { display: string; body: string };
  layoutGrid: string;
  motionSignature: string;
  transitions: string[];
  pacing: { label: string; averageClipMs: number };
  textAnimations: string[];
}

export function fingerprintFromBrief(brief: ArtDirectionBrief, averageClipMs = 4000): StyleFingerprint {
  return {
    palette: {
      background: brief.palette.background.slice(0, 7).toLowerCase(),
      accent: brief.palette.accent.slice(0, 7).toLowerCase(),
      ink: brief.palette.ink.slice(0, 7).toLowerCase(),
      surface: brief.palette.surface.slice(0, 7).toLowerCase(),
    },
    typePairing: { display: brief.typePairing.display, body: brief.typePairing.body },
    layoutGrid: brief.layoutGrid,
    motionSignature: brief.motionSignature,
    transitions: [...new Set(brief.transitionSet)].sort(),
    pacing: { label: brief.pacing, averageClipMs },
    textAnimations: [],
  };
}

export function styleFingerprint(composition: Composition): StyleFingerprint {
  const mainTrack = visualTracks(composition)[0];
  const clips = mainTrack?.clips ?? [];
  const averageClipMs = clips.length ? clips.reduce((sum, clip) => sum + clip.durationMs, 0) / clips.length : composition.durationMs;
  const usedTransitions = new Set<string>();
  const textAnimations = new Set<string>();
  for (const track of visualTracks(composition)) {
    for (const clip of track.clips) {
      if (clip.transitionIn) usedTransitions.add(clip.transitionIn.type);
      for (const layer of clip.layers) if (layer.type === "text" && layer.animation) textAnimations.add(layer.animation.preset);
    }
  }
  const fingerprint = fingerprintFromBrief(composition.brief, Math.round(averageClipMs));
  if (usedTransitions.size > 0) fingerprint.transitions = [...usedTransitions].sort();
  fingerprint.textAnimations = [...textAnimations].sort();
  return fingerprint;
}

export interface SimilarityBreakdown {
  score: number;
  traits: {
    palette: number;
    type: number;
    layout: number;
    motion: number;
    transitions: number;
    pacing: number;
  };
}

const WEIGHTS = { palette: 0.28, type: 0.2, layout: 0.14, motion: 0.14, transitions: 0.12, pacing: 0.12 } as const;

export function styleSimilarity(a: StyleFingerprint, b: StyleFingerprint): SimilarityBreakdown {
  const palette =
    0.45 * colorSimilarity(a.palette.background, b.palette.background) +
    0.35 * colorSimilarity(a.palette.accent, b.palette.accent) +
    0.1 * colorSimilarity(a.palette.ink, b.palette.ink) +
    0.1 * colorSimilarity(a.palette.surface, b.palette.surface);
  const type = (a.typePairing.display === b.typePairing.display ? 0.65 : 0) + (a.typePairing.body === b.typePairing.body ? 0.35 : 0);
  const layout = a.layoutGrid === b.layoutGrid ? 1 : 0;
  const motion = a.motionSignature === b.motionSignature ? 1 : 0;
  const transitions = jaccard(a.transitions, b.transitions);
  const pacingRatio =
    Math.min(a.pacing.averageClipMs, b.pacing.averageClipMs) / Math.max(1, Math.max(a.pacing.averageClipMs, b.pacing.averageClipMs));
  const pacing = 0.5 * (a.pacing.label === b.pacing.label ? 1 : 0) + 0.5 * pacingRatio;
  const traits = { palette, type, layout, motion, transitions, pacing };
  const score =
    WEIGHTS.palette * palette +
    WEIGHTS.type * type +
    WEIGHTS.layout * layout +
    WEIGHTS.motion * motion +
    WEIGHTS.transitions * transitions +
    WEIGHTS.pacing * pacing;
  return { score: Math.round(score * 1000) / 1000, traits };
}

export const DEFAULT_VARIETY_THRESHOLD = 0.72;

export interface VarietyReport {
  tooSimilar: boolean;
  threshold: number;
  closest: { id: string; title: string; score: number; sharedTraits: string[] } | null;
  comparisons: Array<{ id: string; title: string; score: number }>;
}

export function checkVariety(
  fingerprint: StyleFingerprint,
  recent: ReadonlyArray<{ id: string; title: string; fingerprint: StyleFingerprint }>,
  options: { threshold?: number; consistencyRequested?: boolean } = {},
): VarietyReport {
  const threshold = options.threshold ?? DEFAULT_VARIETY_THRESHOLD;
  const comparisons = recent.slice(0, 10).map((entry) => ({ entry, similarity: styleSimilarity(fingerprint, entry.fingerprint) }));
  comparisons.sort((a, b) => b.similarity.score - a.similarity.score);
  const top = comparisons[0];
  const closest = top
    ? {
        id: top.entry.id,
        title: top.entry.title,
        score: top.similarity.score,
        sharedTraits: Object.entries(top.similarity.traits)
          .filter(([, value]) => value >= 0.8)
          .map(([trait]) => trait),
      }
    : null;
  return {
    tooSimilar: !options.consistencyRequested && closest !== null && closest.score >= threshold,
    threshold,
    closest,
    comparisons: comparisons.map(({ entry, similarity }) => ({ id: entry.id, title: entry.title, score: similarity.score })),
  };
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").slice(0, 6);
  const value = Number.parseInt(clean.length === 6 ? clean : "000000", 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** 1 = identical, 0 = opposite corners of the RGB cube (weighted for perception). */
export function colorSimilarity(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const meanRed = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  const distance = Math.sqrt((2 + meanRed / 256) * dr * dr + 4 * dg * dg + (2 + (255 - meanRed) / 256) * db * db);
  return Math.max(0, 1 - distance / 764.8);
}

/** WCAG relative luminance, for contrast checks on on-screen text. */
export function relativeLuminance(hex: string): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
