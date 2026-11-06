import { composeVideo } from "../compose";
import { artDirectionBriefSchema, type Composition } from "../schema";
import { type AspectRatio, FRAME_SIZE } from "../units";
import { placeholderLogo, placeholderPhoto } from "./kit";
import type { FrameShape, TemplateDefinition, TemplateKit } from "./types";

export function frameShape(ratio: AspectRatio): FrameShape {
  const { width, height } = FRAME_SIZE[ratio];
  const aspect = width / height;
  if (aspect < 0.7) return "portrait";
  if (aspect > 1.4) return "landscape";
  return "square";
}

export interface BuildTemplateInput {
  id: string;
  title?: string;
  ratio: AspectRatio;
  /** Slot id → text, or photo src (`asset:<id>`, https URL). Missing slots keep the sample copy / placeholder. */
  values?: Record<string, string>;
  seed?: number;
  /** A music bed already in the asset library for this template. */
  music?: { src: string; label: string; assetId?: string };
}

/** The ratio a template was designed for that is closest to the one asked for. */
export function closestTemplateRatio(template: TemplateDefinition, ratio: AspectRatio): AspectRatio {
  if (template.ratios.includes(ratio)) return ratio;
  const target = FRAME_SIZE[ratio].width / FRAME_SIZE[ratio].height;
  return [...template.ratios].sort((a, b) => Math.abs(Math.log(FRAME_SIZE[a].width / FRAME_SIZE[a].height / target)) - Math.abs(Math.log(FRAME_SIZE[b].width / FRAME_SIZE[b].height / target)))[0] ?? template.ratios[0] ?? "16:9";
}

export function templateKit(template: TemplateDefinition, ratio: AspectRatio, values: Record<string, string> = {}): TemplateKit {
  const { width, height } = FRAME_SIZE[ratio];
  const shape = frameShape(ratio);
  const brief = artDirectionBriefSchema.parse(template.brief);
  const beatMs = 60_000 / template.bpm;
  const slots = new Map(template.slots.map((slot, index) => [slot.id, { slot, index }]));
  return {
    ratio,
    shape,
    width,
    height,
    pick: (byShape) => (shape === "square" ? (byShape.square ?? (width >= height ? byShape.landscape : byShape.portrait)) : byShape[shape]),
    beats: (count) => Math.round(count * beatMs),
    text: (slotId) => {
      const entry = slots.get(slotId);
      if (!entry) throw new Error(`Template ${template.id} has no slot "${slotId}"`);
      const value = values[slotId]?.trim();
      return value || entry.slot.default;
    },
    photo: (slotId) => {
      const entry = slots.get(slotId);
      if (!entry) throw new Error(`Template ${template.id} has no slot "${slotId}"`);
      const value = values[slotId]?.trim();
      if (value) return value;
      if (entry.slot.logo) return placeholderLogo(entry.slot.default, entry.slot.tint ?? [brief.palette.accent, brief.palette.ink]);
      return placeholderPhoto(entry.slot.tint ?? [brief.palette.accent, brief.palette.background], entry.index);
    },
    palette: { ...brief.palette, accent2: brief.palette.accent2 ?? brief.palette.accent },
  };
}

/** A template as an ordinary composition: every layer, keyframe and transition stays editable. */
export function buildTemplate(template: TemplateDefinition, input: BuildTemplateInput): Composition {
  const ratio = closestTemplateRatio(template, input.ratio);
  const kit = templateKit(template, ratio, input.values);
  const brief = artDirectionBriefSchema.parse({ ...template.brief, basedOn: `template:${template.id}` });
  // Slot layers are named after their slot ("Opening photo", "Title") so the editor speaks the template's language.
  const slotLabels = new Map(template.slots.map((slot) => [slot.id, slot.label]));
  const scenes = template.scenes(kit).map((scene) => ({
    ...scene,
    layers: scene.layers.map((layer) => {
      const label = layer.slot ? slotLabels.get(layer.slot) : undefined;
      return label ? { ...layer, name: label } : layer;
    }),
  }));
  return composeVideo({
    id: input.id,
    title: input.title ?? template.name,
    ratio,
    seed: input.seed ?? 1,
    brief,
    scenes: scenes.map((scene, index) => ({
      id: `scene-${index + 1}`,
      name: scene.name,
      durationMs: kit.beats(scene.beats),
      timing: "manual" as const,
      layers: scene.layers,
      ...(scene.background ? { background: scene.background } : {}),
      transition: index === 0 ? null : scene.transition === undefined ? { type: "cut", durationMs: 0 } : scene.transition,
    })),
    ...(input.music ? { music: { ...input.music, volume: 0.8 } } : {}),
  });
}
