import { createSeededRandom } from "@proofcut/motion";

import type { IconName } from "./icons";
import type { ArtDirectionBrief, EasingSpec, Fill, Keyframe, KeyframeMap, LayerInput, TextAnimation } from "./schema";
import type { AspectRatio } from "./units";

/**
 * Recipes: Cutroom's ten blocks re-expressed as functions that expand into
 * primitive layers. A recipe is only a starting point — the output is ordinary
 * layers and keyframes the agent and the user can change freely.
 */

export type SceneSpec =
  | { kind: "headline"; lines: string[]; eyebrow?: string }
  | { kind: "title"; name: string; tagline?: string; eyebrow?: string }
  | { kind: "big-number"; value: number; label: string; line?: string; prefix?: string; suffix?: string; decimals?: number }
  | { kind: "cards"; heading?: string; cards: Array<{ icon: IconName; title: string; line: string }> }
  | { kind: "code"; code: string; language: string; title?: string; caption?: string; highlightLines?: number[]; source?: { path: string; lineStart: number; lineEnd: number } }
  | { kind: "list"; lead?: string; items: string[] }
  | { kind: "flow"; heading?: string; nodes: Array<{ icon?: IconName; label: string; detail?: string }> }
  | { kind: "quote"; quote: string; attribution?: string }
  | { kind: "chart"; heading?: string; chart: "bar" | "line" | "donut"; data: Array<{ label: string; value: number }>; suffix?: string }
  | { kind: "image"; src: string; caption?: string; alt?: string }
  | { kind: "end"; name: string; cta: string; url?: string };

export type SceneKind = SceneSpec["kind"];

type TextLayerInput = Extract<LayerInput, { type: "text" }>;

export interface RecipeContext {
  brief: ArtDirectionBrief;
  ratio: AspectRatio;
  seed: number;
  /** Scene index — varies layout choices between neighbouring scenes. */
  index: number;
  durationMs: number;
  claimIds?: string[];
  idPrefix: string;
}

export interface RecipeOutput {
  layers: LayerInput[];
  background?: Fill;
}

interface Layout {
  portrait: boolean;
  textX: number;
  anchorX: number;
  align: "left" | "center" | "right";
  maxWidth: number;
  headlineSize: number;
  bodySize: number;
}

function layoutFor(context: RecipeContext): Layout {
  const portrait = context.ratio === "9:16" || context.ratio === "4:5";
  const grid = context.brief.layoutGrid;
  const leftAligned = grid === "left-rail" || grid === "editorial-columns" || grid === "asymmetric" || (grid === "split" && !portrait);
  const alternate = grid === "asymmetric" && context.index % 2 === 1;
  const scaleBoost = grid === "full-bleed" ? 1.25 : 1;
  return {
    portrait,
    textX: leftAligned ? (alternate ? 92 : grid === "editorial-columns" ? 10 : 8) : 50,
    anchorX: leftAligned ? (alternate ? 1 : 0) : 0.5,
    align: leftAligned ? (alternate ? "right" : "left") : "center",
    maxWidth: portrait ? 86 : grid === "split" ? 44 : leftAligned ? 70 : 80,
    headlineSize: Math.round((portrait ? 104 : 112) * scaleBoost),
    bodySize: portrait ? 46 : 42,
  };
}

// ── Motion vocabulary per signature ────────────────────────────────────────

interface Entrance {
  keyframes: KeyframeMap;
  textAnimation: TextAnimation;
}

const k = (atMs: number, value: number, easing: EasingSpec = "move"): Keyframe => ({ atMs, value, easing });

function entrance(brief: ArtDirectionBrief, atMs: number, role: "text" | "block"): Entrance {
  const signature = brief.motionSignature;
  const fade = (duration: number): Keyframe[] => [k(atMs, 0, "hold"), k(atMs + duration, 1, "entrance")];
  switch (signature) {
    case "spring-snappy":
      return {
        keyframes: { opacity: fade(420), scale: [k(atMs, 0.94, "hold"), k(atMs + 520, 1, "spring-snappy")] },
        textAnimation: { unit: "word", preset: "scale-in", delayMs: atMs, staggerMs: 60, durationMs: 460, easing: "spring-snappy" },
      };
    case "kinetic":
      return {
        keyframes: { opacity: fade(360), offsetX: [k(atMs, role === "text" ? -60 : 120, "hold"), k(atMs + 600, 0, "spring-momentum")] },
        textAnimation: { unit: "word", preset: "scale-in", delayMs: atMs, staggerMs: 70, durationMs: 480, easing: "spring-snappy" },
      };
    case "staccato":
      return {
        keyframes: { clipTop: [k(atMs, 100, "hold"), k(atMs + 480, 0, "entrance")], offsetY: [k(atMs, 28, "hold"), k(atMs + 480, 0, "entrance")] },
        textAnimation: { unit: "line", preset: "mask-rise", delayMs: atMs, staggerMs: 80, durationMs: 480, easing: "entrance" },
      };
    case "ease-glide":
      return {
        keyframes: { opacity: fade(600), blur: [k(atMs, 6, "hold"), k(atMs + 600, 0, "entrance")], offsetY: [k(atMs, 18, "hold"), k(atMs + 640, 0, "entrance")] },
        textAnimation: { unit: "line", preset: "blur-in", delayMs: atMs, staggerMs: 80, durationMs: 640, easing: "entrance" },
      };
    case "floaty":
      return {
        keyframes: { opacity: fade(640), offsetY: [k(atMs, 40, "hold"), k(atMs + 900, 0, "spring-gentle")] },
        textAnimation: { unit: "word", preset: "fade-rise", delayMs: atMs, staggerMs: 70, durationMs: 640, easing: "spring-gentle" },
      };
    case "cinematic-slow":
      return {
        keyframes: { opacity: fade(700), blur: [k(atMs, 10, "hold"), k(atMs + 800, 0, "entrance")], scale: [k(atMs, 1.04, "hold"), k(atMs + 900, 1, "entrance")] },
        textAnimation: { unit: "char", preset: "blur-in", delayMs: atMs, staggerMs: 40, durationMs: 700, easing: "entrance" },
      };
    case "spring-soft":
    default:
      return {
        keyframes: { opacity: fade(480), offsetY: [k(atMs, 36, "hold"), k(atMs + 640, 0, "spring-smooth")] },
        textAnimation: { unit: "word", preset: "fade-rise", delayMs: atMs, staggerMs: 60, durationMs: 560, easing: "entrance" },
      };
  }
}

function withAlpha(hex: string, alpha: number): string {
  const base = hex.slice(0, 7);
  return `${base}${Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

function isDark(hex: string): boolean {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Ambient decoration that differs by layout and seed: glows, rails, rings. */
function decor(context: RecipeContext, layout: Layout): LayerInput[] {
  const { palette } = context.brief;
  const random = createSeededRandom(context.seed * 31 + context.index * 7);
  const layers: LayerInput[] = [];
  const glowX = layout.anchorX === 0 ? 78 : layout.anchorX === 1 ? 22 : 30 + random() * 40;
  layers.push({
    id: `${context.idPrefix}-glow`,
    type: "shape",
    name: "Glow",
    shape: "ellipse",
    depth: 0.4,
    transform: { x: glowX, y: 60 + random() * 30, width: layout.portrait ? 120 : 70, height: layout.portrait ? 50 : 90, opacity: isDark(palette.background) ? 0.9 : 0.6 },
    fill: { gradient: { kind: "radial", angle: 0, stops: [{ color: withAlpha(palette.accent, isDark(palette.background) ? 0.32 : 0.18), at: 0 }, { color: withAlpha(palette.accent, 0), at: 1 }] } },
    ambient: { kind: "drift", amplitude: 24, periodMs: 9000 },
    keyframes: { opacity: [k(0, 0, "hold"), k(900, isDark(palette.background) ? 0.9 : 0.6, "entrance")] },
  });
  if (context.brief.layoutGrid === "left-rail" || context.brief.motionSignature === "staccato") {
    layers.push({
      id: `${context.idPrefix}-rail`,
      type: "shape",
      name: "Accent rail",
      shape: "rect",
      fill: palette.accent,
      depth: 0,
      transform: { x: 3.2, y: 50, width: 0.6, height: 70 },
      keyframes: { clipBottom: [k(0, 100, "hold"), k(560, 0, "entrance")] },
    });
  }
  if (context.brief.layoutGrid === "grid-3" || context.brief.layoutGrid === "centered") {
    layers.push({
      id: `${context.idPrefix}-ring`,
      type: "shape",
      name: "Ring",
      shape: "ring",
      stroke: withAlpha(palette.ink, 0.08),
      strokeWidth: 2,
      depth: 0.6,
      transform: { x: 50, y: 50, width: layout.portrait ? 110 : 62, height: layout.portrait ? 62 : 110, opacity: 1 },
      ambient: { kind: "pulse", amplitude: 0.02, periodMs: 6000 },
      keyframes: { scale: [k(0, 0.92, "hold"), k(1400, 1, "entrance")], opacity: [k(0, 0, "hold"), k(800, 1, "entrance")] },
    });
  }
  return layers;
}

function textLayer(
  context: RecipeContext,
  options: {
    id: string;
    text: string;
    y: number;
    size: number;
    weight?: number;
    font?: "display" | "body" | "mono";
    color?: string;
    atMs: number;
    layout: Layout;
    uppercase?: boolean;
    tracking?: number;
    animate?: boolean;
    maxWidth?: number;
    x?: number;
  },
): TextLayerInput {
  const motion = entrance(context.brief, options.atMs, "text");
  const animate = options.animate !== false;
  return {
    id: `${context.idPrefix}-${options.id}`,
    type: "text",
    name: options.id,
    text: options.text,
    claimIds: context.claimIds ?? [],
    transform: { x: options.x ?? options.layout.textX, y: options.y, anchorX: options.layout.anchorX, anchorY: 0.5 },
    style: {
      font: options.font ?? "display",
      size: options.size,
      weight: options.weight ?? 700,
      color: options.color ?? context.brief.palette.ink,
      accentColor: context.brief.palette.accent,
      align: options.layout.align,
      uppercase: options.uppercase ?? false,
      tracking: options.tracking ?? (options.size >= 80 ? -0.03 : 0),
      leading: options.size >= 80 ? 1.04 : 1.25,
      maxWidth: options.maxWidth ?? options.layout.maxWidth,
    },
    ...(animate ? { animation: motion.textAnimation } : { keyframes: { opacity: [k(options.atMs, 0, "hold"), k(options.atMs + 480, 1, "entrance")] } }),
  };
}

function eyebrow(context: RecipeContext, layout: Layout, text: string, y: number): LayerInput {
  return textLayer(context, {
    id: "eyebrow",
    text,
    y,
    size: 28,
    weight: 600,
    font: "mono",
    color: context.brief.palette.accent,
    atMs: 0,
    layout,
    uppercase: true,
    tracking: 0.14,
    animate: false,
  });
}

// ── Recipes ────────────────────────────────────────────────────────────────

export function expandRecipe(spec: SceneSpec, context: RecipeContext): RecipeOutput {
  const layout = layoutFor(context);
  const layers: LayerInput[] = [...decor(context, layout)];
  const { palette } = context.brief;
  const body = (id: string, text: string, y: number, atMs: number, extra: Partial<Parameters<typeof textLayer>[1]> = {}) =>
    textLayer(context, { id, text, y, size: layout.bodySize, weight: 450, font: "body", color: palette.muted, atMs, layout, ...extra });

  switch (spec.kind) {
    case "headline": {
      if (spec.eyebrow) layers.push(eyebrow(context, layout, spec.eyebrow, layout.portrait ? 36 : 30));
      layers.push(
        textLayer(context, { id: "headline", text: spec.lines.join("\n"), y: 50, size: layout.headlineSize, atMs: spec.eyebrow ? 200 : 80, layout }),
      );
      break;
    }
    case "title": {
      if (spec.eyebrow) layers.push(eyebrow(context, layout, spec.eyebrow, 36));
      layers.push(textLayer(context, { id: "name", text: spec.name, y: 47, size: Math.round(layout.headlineSize * 1.25), atMs: 160, layout }));
      if (spec.tagline) layers.push(body("tagline", spec.tagline, layout.portrait ? 60 : 62, 520));
      break;
    }
    case "big-number": {
      layers.push(eyebrow(context, layout, spec.label, layout.portrait ? 32 : 28));
      layers.push({
        id: `${context.idPrefix}-number`,
        type: "chart",
        name: "Number",
        chart: "number",
        claimIds: context.claimIds ?? [],
        data: [{ label: spec.label, value: spec.value }],
        prefix: spec.prefix ?? "",
        suffix: spec.suffix ?? "",
        decimals: spec.decimals ?? 0,
        colors: [palette.ink],
        fontSize: layout.portrait ? 220 : 240,
        transform: { x: layout.textX, y: 50, anchorX: layout.anchorX, width: 80, height: 30 },
        keyframes: {
          ...entrance(context.brief, 120, "block").keyframes,
          progress: [k(120, 0, "hold"), k(1500, 1, "entrance")],
        },
      });
      if (spec.line) layers.push(body("line", spec.line, layout.portrait ? 66 : 72, 900));
      break;
    }
    case "cards": {
      if (spec.heading) layers.push(textLayer(context, { id: "heading", text: spec.heading, y: layout.portrait ? 18 : 22, size: 64, atMs: 0, layout }));
      const count = spec.cards.length;
      spec.cards.forEach((card, index) => {
        const atMs = 260 + index * 80;
        const motion = entrance(context.brief, atMs, "block");
        const width = layout.portrait ? 84 : (84 - (count - 1) * 2.5) / count;
        const height = layout.portrait ? Math.min(16, 56 / count) : 39;
        const x = layout.portrait ? 50 : 8 + width / 2 + index * (width + 2.5);
        const y = layout.portrait ? 34 + index * (height + 2.5) + height / 2 : 57;
        const left = x - width / 2;
        const top = y - height / 2;
        layers.push({
          id: `${context.idPrefix}-card-${index + 1}`,
          type: "group",
          name: `Card ${index + 1}`,
          claimIds: context.claimIds ?? [],
          transform: { x, y },
          keyframes: motion.keyframes,
          children: [
            { id: `${context.idPrefix}-card-${index + 1}-bg`, type: "shape", shape: "rect", fill: palette.surface, radius: 28, stroke: withAlpha(palette.ink, 0.08), strokeWidth: 2, transform: { x, y, width, height }, shadow: { color: isDark(palette.background) ? "#00000099" : "#5c482822", blur: 48, x: 0, y: 18 } },
            { id: `${context.idPrefix}-card-${index + 1}-icon`, type: "icon", icon: card.icon, color: palette.accent, transform: { x: left + (layout.portrait ? 6 : 4.5), y: top + (layout.portrait ? height / 2 : 9), width: layout.portrait ? 6 : 3.4, height: layout.portrait ? 3.4 : 6 } },
            {
              id: `${context.idPrefix}-card-${index + 1}-title`,
              type: "text",
              text: card.title,
              transform: { x: left + (layout.portrait ? 12 : 3), y: top + (layout.portrait ? height * 0.36 : 19), anchorX: 0 },
              style: { font: "display", size: 40, weight: 700, color: palette.ink, align: "left", maxWidth: width - 6, tracking: -0.01, leading: 1.1 },
            },
            {
              id: `${context.idPrefix}-card-${index + 1}-line`,
              type: "text",
              text: card.line,
              transform: { x: left + (layout.portrait ? 12 : 3), y: top + (layout.portrait ? height * 0.66 : 27), anchorX: 0, anchorY: 0 },
              style: { font: "body", size: 30, weight: 450, color: palette.muted, align: "left", maxWidth: width - 6, leading: 1.3, tracking: 0 },
            },
          ],
        });
      });
      break;
    }
    case "code": {
      const width = layout.portrait ? 88 : context.brief.layoutGrid === "split" ? 52 : 70;
      const x = layout.portrait ? 50 : context.brief.layoutGrid === "split" ? 70 : 50;
      if (context.brief.layoutGrid === "split" && !layout.portrait && spec.caption) {
        layers.push(textLayer(context, { id: "caption", text: spec.caption, y: 50, size: 64, atMs: 0, layout, maxWidth: 34 }));
      }
      layers.push({
        id: `${context.idPrefix}-code`,
        type: "code",
        name: "Code",
        code: spec.code,
        language: spec.language,
        ...(spec.title ? { title: spec.title } : {}),
        theme: isDark(palette.background) ? "dark" : "light",
        fontSize: layout.portrait ? 26 : 28,
        highlightLines: spec.highlightLines ?? [],
        reveal: "lines",
        ...(spec.source ? { source: spec.source } : {}),
        claimIds: context.claimIds ?? [],
        transform: { x, y: layout.portrait ? 46 : 50, width, height: layout.portrait ? 44 : 64 },
        shadow: { color: "#00000080", blur: 60, x: 0, y: 24 },
        keyframes: { ...entrance(context.brief, 160, "block").keyframes, progress: [k(160, 0, "hold"), k(1600, 1, "linear")] },
      });
      if (spec.caption && !(context.brief.layoutGrid === "split" && !layout.portrait)) {
        layers.push(body("caption", spec.caption, layout.portrait ? 78 : 89, 700, { x: 50, maxWidth: 80 }));
      }
      break;
    }
    case "list": {
      if (spec.lead) layers.push(textLayer(context, { id: "lead", text: spec.lead, y: layout.portrait ? 26 : 28, size: 72, atMs: 0, layout }));
      layers.push({
        ...textLayer(context, {
          id: "items",
          text: spec.items.map((item) => `• ${item}`).join("\n"),
          y: layout.portrait ? 56 : 60,
          size: layout.portrait ? 52 : 50,
          weight: 600,
          font: "body",
          atMs: 320,
          layout,
        }),
        animation: { ...entrance(context.brief, 320, "text").textAnimation, unit: "line", staggerMs: 80 },
      });
      break;
    }
    case "flow": {
      if (spec.heading) layers.push(textLayer(context, { id: "heading", text: spec.heading, y: layout.portrait ? 16 : 22, size: 60, atMs: 0, layout }));
      const count = spec.nodes.length;
      spec.nodes.forEach((node, index) => {
        const atMs = 240 + index * 220;
        const x = layout.portrait ? 50 : 12 + (76 / Math.max(1, count - 1)) * index;
        const y = layout.portrait ? 30 + (56 / Math.max(1, count - 1)) * index : 58;
        layers.push({
          id: `${context.idPrefix}-node-${index + 1}`,
          type: "group",
          name: `Step ${index + 1}`,
          transform: { x, y },
          keyframes: entrance(context.brief, atMs, "block").keyframes,
          children: [
            { id: `${context.idPrefix}-node-${index + 1}-bg`, type: "shape", shape: "rect", fill: palette.surface, radius: 24, stroke: withAlpha(palette.accent, 0.5), strokeWidth: 2, transform: { x, y, width: layout.portrait ? 70 : 17, height: layout.portrait ? 9 : 22 } },
            { id: `${context.idPrefix}-node-${index + 1}-index`, type: "text", text: String(index + 1).padStart(2, "0"), transform: { x: layout.portrait ? x - 30 : x, y: layout.portrait ? y : y - 6.5 }, style: { font: "mono", size: 26, weight: 500, color: palette.accent, align: "center" } },
            { id: `${context.idPrefix}-node-${index + 1}-label`, type: "text", text: node.label, transform: { x, y: layout.portrait ? y : y + 1 }, style: { font: "display", size: 36, weight: 700, color: palette.ink, align: "center", maxWidth: layout.portrait ? 50 : 15, leading: 1.1 } },
          ],
        });
        if (index < count - 1) {
          layers.push({
            id: `${context.idPrefix}-link-${index + 1}`,
            type: "shape",
            name: `Connector ${index + 1}`,
            shape: "rect",
            fill: palette.accent,
            transform: layout.portrait
              ? { x, y: y + 28 / Math.max(1, count - 1), width: 0.5, height: 56 / Math.max(1, count - 1) - 10 }
              : { x: x + 38 / Math.max(1, count - 1), y, width: 76 / Math.max(1, count - 1) - 18, height: 0.5 },
            keyframes: layout.portrait
              ? { clipBottom: [k(atMs + 200, 100, "hold"), k(atMs + 520, 0, "move")] }
              : { clipRight: [k(atMs + 200, 100, "hold"), k(atMs + 520, 0, "move")] },
          });
        }
      });
      break;
    }
    case "quote": {
      layers.push(textLayer(context, { id: "mark", text: "“", y: layout.portrait ? 30 : 26, size: 220, color: palette.accent, atMs: 0, layout, animate: false }));
      layers.push(textLayer(context, { id: "quote", text: spec.quote, y: 50, size: layout.portrait ? 64 : 70, weight: 600, atMs: 160, layout }));
      if (spec.attribution) layers.push(body("attribution", `— ${spec.attribution}`, layout.portrait ? 70 : 74, 800));
      break;
    }
    case "chart": {
      if (spec.heading) layers.push(textLayer(context, { id: "heading", text: spec.heading, y: layout.portrait ? 20 : 20, size: 60, atMs: 0, layout }));
      layers.push({
        id: `${context.idPrefix}-chart`,
        type: "chart",
        name: "Chart",
        chart: spec.chart,
        data: spec.data,
        suffix: spec.suffix ?? "",
        colors: [palette.accent, palette.accent2 ?? palette.ink, palette.muted],
        fontSize: 30,
        claimIds: context.claimIds ?? [],
        transform: { x: 50, y: layout.portrait ? 56 : 60, width: layout.portrait ? 86 : 74, height: layout.portrait ? 48 : 58 },
        keyframes: { ...entrance(context.brief, 200, "block").keyframes, progress: [k(200, 0, "hold"), k(1600, 1, "entrance")] },
      });
      break;
    }
    case "image": {
      layers.push({
        id: `${context.idPrefix}-image`,
        type: "image",
        name: "Image",
        src: spec.src,
        ...(spec.alt ? { alt: spec.alt } : {}),
        radius: 28,
        transform: { x: 50, y: layout.portrait ? 44 : 46, width: layout.portrait ? 88 : 72, height: layout.portrait ? 52 : 70 },
        shadow: { color: "#00000080", blur: 60, x: 0, y: 24 },
        keyframes: { ...entrance(context.brief, 80, "block").keyframes, scale: [k(80, 1.06, "hold"), k(context.durationMs, 1, "linear")] },
      });
      if (spec.caption) layers.push(body("caption", spec.caption, layout.portrait ? 80 : 88, 500, { x: 50, maxWidth: 80 }));
      break;
    }
    case "end": {
      layers.push(textLayer(context, { id: "name", text: spec.name, y: layout.portrait ? 40 : 38, size: layout.headlineSize, atMs: 80, layout }));
      const pillX = layout.anchorX === 0 ? layout.textX + 14 : layout.anchorX === 1 ? layout.textX - 14 : 50;
      layers.push({
        id: `${context.idPrefix}-cta`,
        type: "group",
        name: "CTA",
        transform: { x: pillX, y: 58 },
        keyframes: { opacity: [k(520, 0, "hold"), k(900, 1, "entrance")], scale: [k(520, 0.92, "hold"), k(1000, 1, "spring-smooth")] },
        children: [
          { id: `${context.idPrefix}-cta-bg`, type: "shape", shape: "rect", fill: palette.accent, radius: 999, transform: { x: pillX, y: 58, width: layout.portrait ? 64 : 28, height: layout.portrait ? 6.5 : 10 } },
          { id: `${context.idPrefix}-cta-label`, type: "text", text: spec.cta, transform: { x: pillX, y: 58 }, style: { font: "body", size: 38, weight: 700, color: isDark(palette.accent) ? "#ffffff" : "#0b0b0c", align: "center" } },
        ],
      });
      if (spec.url) layers.push(body("url", spec.url, layout.portrait ? 68 : 72, 900, { font: "mono", size: 30, x: pillX }));
      break;
    }
  }
  return {
    layers,
    background: isDark(palette.background)
      ? { gradient: { kind: "radial", angle: 0, stops: [{ color: palette.surface, at: 0 }, { color: palette.background, at: 1 }] } }
      : palette.background,
  };
}
