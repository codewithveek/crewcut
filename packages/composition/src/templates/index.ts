import type { AspectRatio } from "../units";
import { brandReveal } from "./library/brand-reveal";
import { eventNight } from "./library/event-night";
import { goldenHour } from "./library/golden-hour";
import { kineticQuote } from "./library/kinetic-quote";
import { productDrop } from "./library/product-drop";
import { topFive } from "./library/top-five";
import type { TemplateCategory, TemplateDefinition } from "./types";

export * from "./build";
export * from "./data";
export * from "./kit";
export * from "./types";

/** The curated template library, in gallery order. */
export const TEMPLATES: readonly TemplateDefinition[] = [goldenHour, productDrop, eventNight, topFive, kineticQuote, brandReveal];

export function getTemplate(id: string): TemplateDefinition | null {
  return TEMPLATES.find((template) => template.id === id) ?? null;
}

/** Durations in ms (from the beat grid), for cards and filters. */
export function templateDurationMs(template: TemplateDefinition, ratio?: AspectRatio): number {
  const beats = template.scenes(
    // Scene lengths don't depend on slot values; a throwaway kit is enough to count beats.
    { ratio: ratio ?? template.ratios[0] ?? "16:9", shape: "portrait", width: 1080, height: 1920, pick: (byShape) => byShape.portrait, beats: (count) => count, text: () => "x", photo: () => "x", palette: { background: "#000000", surface: "#000000", ink: "#000000", muted: "#000000", accent: "#000000", accent2: "#000000" } },
  ).reduce((sum, scene) => sum + scene.beats, 0);
  return Math.round((beats * 60_000) / template.bpm);
}

export interface TemplateSearch {
  query?: string;
  ratio?: AspectRatio;
  category?: TemplateCategory;
}

/** Library search: words match name, description, tags and category; ratio and category filter. */
export function searchTemplates(search: TemplateSearch = {}): TemplateDefinition[] {
  const words = (search.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return TEMPLATES.filter((template) => {
    if (search.ratio && !template.ratios.includes(search.ratio)) return false;
    if (search.category && template.category !== search.category) return false;
    if (words.length === 0) return true;
    const haystack = [template.name, template.description, template.category, ...template.tags].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
