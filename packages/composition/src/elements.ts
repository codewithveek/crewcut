import type { IconName } from "./icons";
import type { ArtDirectionBrief, LayerDraft } from "./schema";

/**
 * Ready-made elements for the editor's Text and Elements tabs (and the
 * agent). Each builds a layer from the composition's art direction so new
 * elements match the video's palette and type pairing.
 */

export interface TextPreset {
  id: string;
  label: string;
  sample: string;
  build: (brief: ArtDirectionBrief, text?: string) => LayerDraft;
}

const enter = { unit: "word" as const, preset: "fade-rise" as const, delayMs: 0, staggerMs: 60, durationMs: 520, easing: "entrance" as const };

export const TEXT_PRESETS: readonly TextPreset[] = [
  {
    id: "title",
    label: "Title",
    sample: "Big *bold* title",
    build: (brief, text) => ({ type: "text", name: "Title", text: text ?? "Big *bold* title", style: { font: "display", size: 120, weight: 800, color: brief.palette.ink, accentColor: brief.palette.accent, maxWidth: 84 } }),
  },
  {
    id: "subtitle",
    label: "Subtitle",
    sample: "A clear subtitle",
    build: (brief, text) => ({ type: "text", name: "Subtitle", text: text ?? "A clear subtitle", style: { font: "display", size: 64, weight: 600, color: brief.palette.ink, maxWidth: 80 } }),
  },
  {
    id: "body",
    label: "Body",
    sample: "Body text for details and context.",
    build: (brief, text) => ({ type: "text", name: "Body", text: text ?? "Body text for details and context.", style: { font: "body", size: 44, weight: 400, color: brief.palette.ink, leading: 1.35, maxWidth: 64, tracking: 0 } }),
  },
  {
    id: "lower-third",
    label: "Lower third",
    sample: "Name · Role",
    build: (brief, text) => ({
      type: "text",
      name: "Lower third",
      text: text ?? "Name · Role",
      transform: { x: 6, y: 84, anchorX: 0, anchorY: 0.5 },
      style: { font: "body", size: 40, weight: 600, align: "left", color: "#ffffff", background: "#000000c0", padding: 22, radius: 14, tracking: 0, maxWidth: 70 },
    }),
  },
  {
    id: "label",
    label: "Label",
    sample: "NEW",
    build: (brief, text) => ({
      type: "text",
      name: "Label",
      text: text ?? "NEW",
      style: { font: "body", size: 30, weight: 700, uppercase: true, tracking: 0.08, color: brief.palette.background, background: brief.palette.accent, padding: 16, radius: 200 },
    }),
  },
  {
    id: "quote",
    label: "Quote",
    sample: "“Make it feel right.”",
    build: (brief, text) => ({ type: "text", name: "Quote", text: text ?? "“Make it feel right.”", style: { font: "Instrument Serif", size: 96, weight: 400, italic: true, color: brief.palette.ink, maxWidth: 76, tracking: -0.01 } }),
  },
  {
    id: "big-number",
    label: "Big number",
    sample: "87%",
    build: (brief, text) => ({ type: "text", name: "Big number", text: text ?? "87%", style: { font: "display", size: 280, weight: 800, color: brief.palette.accent, tracking: -0.04 } }),
  },
  {
    id: "outline",
    label: "Outline",
    sample: "STROKE TEXT",
    build: (_brief, text) => ({ type: "text", name: "Outline", text: text ?? "STROKE TEXT", style: { font: "display", size: 110, weight: 900, uppercase: true, color: "#ffffff", strokeColor: "#000000", strokeWidth: 8, maxWidth: 86 } }),
  },
  {
    id: "neon",
    label: "Neon",
    sample: "Neon glow",
    build: (brief, text) => ({
      type: "text",
      name: "Neon",
      text: text ?? "Neon glow",
      style: { font: "display", size: 110, weight: 700, color: "#ffffff" },
      shadow: { color: `${brief.palette.accent.slice(0, 7)}ee`, blur: 36, x: 0, y: 0 },
    }),
  },
  {
    id: "typewriter",
    label: "Typewriter",
    sample: "typing in…",
    build: (brief, text) => ({ type: "text", name: "Typewriter", text: text ?? "typing in…", style: { font: "mono", size: 64, weight: 500, color: brief.palette.ink, tracking: 0 }, animation: { ...enter, preset: "typewriter", unit: "char", staggerMs: 40 } }),
  },
];

export interface ShapeElement {
  id: string;
  label: string;
  build: (brief: ArtDirectionBrief) => LayerDraft;
}

export const SHAPE_ELEMENTS: readonly ShapeElement[] = [
  { id: "card", label: "Card", build: (brief) => ({ type: "shape", name: "Card", shape: "rect", fill: brief.palette.surface, radius: 32, transform: { width: 56, height: 46 }, shadow: { color: "#00000055", blur: 60, x: 0, y: 24 } }) },
  { id: "pill", label: "Pill", build: (brief) => ({ type: "shape", name: "Pill", shape: "rect", fill: brief.palette.accent, radius: 400, transform: { width: 30, height: 9 } }) },
  { id: "circle", label: "Circle", build: (brief) => ({ type: "shape", name: "Circle", shape: "ellipse", fill: brief.palette.accent, transform: { width: 18, height: 32 } }) },
  { id: "ring", label: "Ring", build: (brief) => ({ type: "shape", name: "Ring", shape: "ring", stroke: brief.palette.accent, strokeWidth: 12, transform: { width: 20, height: 35.5 } }) },
  { id: "line", label: "Line", build: (brief) => ({ type: "shape", name: "Line", shape: "line", stroke: brief.palette.ink, strokeWidth: 6, transform: { width: 40, height: 1 } }) },
  { id: "triangle", label: "Triangle", build: (brief) => ({ type: "shape", name: "Triangle", shape: "triangle", fill: brief.palette.accent, transform: { width: 16, height: 26 } }) },
  {
    id: "gradient",
    label: "Gradient",
    build: (brief) => ({ type: "shape", name: "Gradient wash", shape: "rect", fill: { gradient: { kind: "linear", angle: 135, stops: [{ color: brief.palette.accent, at: 0 }, { color: brief.palette.accent2 ?? brief.palette.surface, at: 1 }] } }, transform: { width: 100, height: 100 }, blendMode: "soft-light" }),
  },
  { id: "frame", label: "Frame", build: (brief) => ({ type: "shape", name: "Frame", shape: "rect", stroke: brief.palette.ink, strokeWidth: 6, radius: 24, transform: { width: 80, height: 80 } }) },
];

export const STICKER_ICONS: readonly IconName[] = [
  "check",
  "circle-check",
  "star",
  "sparkle",
  "zap",
  "heart",
  "rocket",
  "arrow-right",
  "arrow-up-right",
  "trending-up",
  "lightbulb",
  "target",
  "clock",
  "eye",
  "mic",
  "play",
  "wand",
  "shield",
];

export function iconElement(brief: ArtDirectionBrief, icon: IconName): LayerDraft {
  return { type: "icon", name: icon, icon, color: brief.palette.accent, strokeWidth: 2, transform: { width: 12, height: 21.33 } };
}
