import type { ArtDirectionBriefInput, Fill, LayerInput, Transition } from "../schema";
import type { AspectRatio } from "../units";

export const TEMPLATE_CATEGORIES = ["promo", "social", "travel", "quote", "listicle", "event", "brand", "recap", "tutorial"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  promo: "Product & promo",
  social: "Social",
  travel: "Travel & lifestyle",
  quote: "Quotes",
  listicle: "Lists & tips",
  event: "Events",
  brand: "Brand intros",
  recap: "Recaps",
  tutorial: "How-to",
};

/**
 * What a person (or the agent) fills in. Photo slots take a library asset, a
 * stock photo URL or keep their designed placeholder; text slots take words.
 */
export interface TemplateSlot {
  id: string;
  kind: "photo" | "text";
  label: string;
  /** Text: the sample copy. Photo: the stock search that suits the design ("golden hour coastline"). */
  default: string;
  /** Text: keep copy short enough for the design. */
  maxLength?: number;
  /** Guidance for the agent when it writes or picks this slot. */
  hint?: string;
  /** Photo: the placeholder gradient's two colours (until a real photo fills it). */
  tint?: readonly [string, string];
  /** Photo: a logo (never filled from stock; the placeholder is a monogram of `default`). */
  logo?: boolean;
}

/** One scene, timed in music beats so cuts land on the beat. */
export interface TemplateScene {
  name: string;
  beats: number;
  layers: LayerInput[];
  background?: Fill;
  /** Into this scene; null (or omitted on the first) is a hard cut. */
  transition?: Partial<Transition> | null;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  tags: readonly string[];
  /** Ratios this template is designed for (each one laid out on purpose, not squeezed). */
  ratios: readonly AspectRatio[];
  /** Tempo the scenes are cut to; the music is made or picked at this tempo. */
  bpm: number;
  /** What the soundtrack should sound like (generation prompt / library search). */
  music: { prompt: string; mood: string };
  slots: readonly TemplateSlot[];
  brief: ArtDirectionBriefInput;
  scenes: (kit: TemplateKit) => TemplateScene[];
}

export type FrameShape = "portrait" | "square" | "landscape";

/** Everything a template's scene builder needs for one ratio and one set of slot values. */
export interface TemplateKit {
  ratio: AspectRatio;
  shape: FrameShape;
  width: number;
  height: number;
  /** Pick a value per frame shape (square covers 1:1, 4:5 and 4:3, 3:4). */
  pick: <T>(byShape: { portrait: T; square?: T; landscape: T }) => T;
  /** Duration of n beats in ms. */
  beats: (count: number) => number;
  text: (slotId: string) => string;
  /** Layer src for a photo slot (asset, URL or the designed placeholder). */
  photo: (slotId: string) => string;
  palette: { background: string; surface: string; ink: string; muted: string; accent: string; accent2: string };
}
