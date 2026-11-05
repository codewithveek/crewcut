import { z } from "zod";

import { applyMotionPreset } from "./motion-presets";
import {
  type ClipInput,
  type ClipPatch,
  type LayerPatch,
  addCaption,
  addClip,
  addElementClip,
  addLayer,
  addMediaClip,
  addTrack,
  alignLayers,
  deleteClips,
  distributeLayers,
  duplicateClips,
  duplicateLayers,
  groupLayers,
  moveClip,
  moveKeyframes,
  nudgeLayers,
  pasteClips,
  pasteLayers,
  removeKeyframe,
  removeLayers,
  removeMarker,
  removeTrack,
  reorderLayer,
  reorderTrack,
  setArtDirection,
  setCaptionStyle,
  setClipSpeed,
  setFormat,
  setKeyframe,
  setMarker,
  setTrackState,
  setTransition,
  setVolumeEnvelope,
  splitClip,
  trimClip,
  updateCaption,
  updateClip,
  updateLayer,
} from "./ops";
import { type Composition, type LayerDraft, type LayerInput, animatablePropertySchema, easingSchema, envelopePointSchema, transitionSchema } from "./schema";
import { ASPECT_RATIOS } from "./units";

/**
 * Every composition edit as data. The editor applies these optimistically in
 * the browser and the `edit-composition` action applies the same list on the
 * server, so one batch = one undoable version with identical results.
 */
const target = z.object({ clipId: z.string(), layerId: z.string() });
const trackSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("visual") }),
  z.object({ kind: z.literal("audio"), role: z.enum(["voice", "music", "sfx"]) }),
  z.object({ kind: z.literal("caption") }),
]);
/*
 * Tool-facing shapes declare their fields explicitly. A bare
 * `{ type }.passthrough()` gives a model nothing to fill in (and some
 * gateways drop undeclared keys), so agents sent `{ type: "text" }` with no
 * text. Ops still validate against the full layer/clip schemas when applied.
 */
// Some models fill every optional tool field with filler (null, "", {}, []).
// Agent-Native strips filler the schema rejects but refuses a call that mixes
// rejected and accepted filler. So every optional field here accepts empty
// filler ("nullish", loose strings), and cleanOp() drops it before applying.
const looseRecord = (hint: string) => z.record(z.string(), z.unknown()).describe(hint);
const fillInput = z.union([z.string(), looseRecord("{ gradient: { kind: linear|radial, angle, stops: [{ color, at }] } }")]);

const layerInput = z
  .object({
    type: z.enum(["text", "shape", "image", "video", "code", "chart", "icon", "group", "camera"]),
    id: z.string().nullish(),
    name: z.string().max(80).nullish(),
    startMs: z.number().nullish().describe("ms from the clip start (negative = already on screen)"),
    durationMs: z.number().positive().nullish().describe("defaults to the rest of the clip"),
    text: z.string().max(600).nullish().describe("text layers (required): the words; wrap words in *stars* to accent them; \\n breaks lines"),
    style: looseRecord("text layers: { font: display|body|mono|<family>, size (design px vs a 1080 short side, e.g. 64–160), weight, color #hex, accentColor, align left|center|right, uppercase, background, padding, radius, strokeColor, strokeWidth }").nullish(),
    transform: looseRecord("{ x, y (% of frame, 50/50 = centre), width, height (% of frame), anchorX/anchorY 0..1, scale, scaleX, scaleY, rotation (deg), opacity 0..1, blur, offsetX, offsetY, clipTop/Right/Bottom/Left (%) }").nullish(),
    keyframes: looseRecord("{ <property>: [{ atMs, value, easing }] } — atMs from the layer start").nullish(),
    animation: looseRecord("text reveal: { preset: fade-rise|mask-rise|blur-in|scale-in|typewriter|highlight, unit: word|line|char, staggerMs, durationMs, delayMs }").nullish(),
    shape: z.string().nullish().describe("shape layers (required): rect|ellipse|line|ring|triangle"),
    fill: fillInput.nullish().describe("shape fill: #hex or { gradient: { kind, angle, stops: [{ color, at }] } }"),
    stroke: z.string().nullish(),
    strokeWidth: z.number().nullish(),
    radius: z.number().nullish().describe("corner radius, design px"),
    src: z.string().nullish().describe("image/video layers (required): asset:<assetId>"),
    fit: z.string().nullish().describe("cover|contain"),
    volume: z.number().nullish().describe("video layers: 0..2"),
    icon: z.string().nullish().describe("icon layers (required): an icon name"),
    color: z.string().nullish().describe("icon colour"),
    code: z.string().nullish().describe("code layers (required)"),
    language: z.string().nullish(),
    chart: z.string().nullish().describe("chart layers (required): bar|line|donut|number"),
    data: z.array(z.object({ label: z.string(), value: z.number() })).nullish().describe("chart layers (required)"),
    blendMode: z.string().nullish(),
    filter: looseRecord("{ preset: mono|noir|sepia|warm|cool|vivid|fade|dramatic|vintage|dreamy, intensity 0..1 }").nullish(),
    adjust: looseRecord("{ brightness, contrast, saturation, temperature, tint, vignette (-100..100 except vignette 0..100), hue (deg) }").nullish(),
    shadow: looseRecord("{ color, blur, x, y }").nullish(),
  })
  .passthrough();

/** Clipboard payloads come from the editor, not the model: keep them loose and small. */
const clipboardLayer = z.object({ type: z.string() }).passthrough();

const clipInput = z
  .object({
    id: z.string().nullish(),
    name: z.string().max(80).nullish(),
    startMs: z.number().min(0),
    durationMs: z.number().min(1),
    layers: z.array(clipboardLayer).nullish().describe("visual clips: layers, bottom first (same fields as add-layer); prefer add-element-clip or add-layer"),
    background: fillInput.nullish().describe("visual clips: #hex or gradient fill"),
    src: z.string().nullish().describe("audio clips (required): asset:<assetId>"),
    volume: z.number().nullish(),
    fadeInMs: z.number().nullish(),
    fadeOutMs: z.number().nullish(),
    text: z.string().nullish().describe("caption clips (required): the caption; audio clips: a label"),
  })
  .passthrough();
const media = z.object({
  assetId: z.string(),
  mediaType: z.enum(["image", "video", "audio"]),
  durationMs: z.number().positive().nullish(),
  label: z.string().max(120).nullish(),
  kind: z.string().nullish(),
});

export const compositionOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("trim-clip"), clipId: z.string(), edge: z.enum(["start", "end"]), toMs: z.number().min(0), ripple: z.boolean().nullish() }),
  z.object({ op: z.literal("move-clip"), clipId: z.string(), startMs: z.number().min(0), trackId: z.string().nullish() }),
  z.object({ op: z.literal("split-clip"), clipId: z.string(), atMs: z.number().min(0) }),
  z.object({ op: z.literal("delete-clips"), clipIds: z.array(z.string()).min(1), ripple: z.boolean().nullish() }),
  z.object({ op: z.literal("add-clip"), trackId: z.string(), clip: clipInput, ripple: z.boolean().nullish() }),
  z.object({ op: z.literal("update-clip"), clipId: z.string(), patch: looseRecord("fields to change: name, background, volume, fadeInMs, fadeOutMs, playbackRate, duckUnderVoice, text, filter, adjust (null removes)") }),
  z.object({ op: z.literal("duplicate-clips"), clipIds: z.array(z.string()).min(1) }),
  z.object({ op: z.literal("paste-clips"), atMs: z.number().min(0), items: z.array(z.object({ trackId: z.string().nullish(), track: trackSpec, clip: clipInput })).min(1).max(100) }),
  z.object({ op: z.literal("set-clip-speed"), clipId: z.string(), rate: z.number().min(0.25).max(4) }),
  z.object({ op: z.literal("add-media-clip"), media, atMs: z.number().min(0), trackId: z.string().nullish(), clipId: z.string().nullish(), mode: z.enum(["auto", "overlay"]).nullish() }),
  z.object({ op: z.literal("add-element-clip"), layer: layerInput, atMs: z.number().min(0), durationMs: z.number().positive().nullish(), trackId: z.string().nullish(), clipId: z.string().nullish(), name: z.string().max(80).nullish() }),
  z.object({ op: z.literal("add-track"), track: trackSpec, id: z.string().nullish(), name: z.string().max(60).nullish(), index: z.number().int().min(0).nullish() }),
  z.object({ op: z.literal("remove-track"), trackId: z.string() }),
  z.object({ op: z.literal("reorder-track"), trackId: z.string(), toIndex: z.number().int().min(0) }),
  z.object({ op: z.literal("set-keyframe"), clipId: z.string(), layerId: z.string(), property: animatablePropertySchema, atMs: z.number(), value: z.number(), easing: easingSchema.nullish() }),
  z.object({ op: z.literal("remove-keyframe"), clipId: z.string(), layerId: z.string(), property: animatablePropertySchema, atMs: z.number() }),
  z.object({ op: z.literal("move-keyframes"), clipId: z.string(), layerId: z.string(), fromMs: z.number(), toMs: z.number(), property: animatablePropertySchema.nullish() }),
  z.object({ op: z.literal("update-layer"), clipId: z.string(), layerId: z.string(), patch: looseRecord("fields to change, same names as add-layer (text, style, transform, fill, src, filter, adjust, hidden, flipX…); nested style/transform/adjust merge; null removes") }),
  z.object({ op: z.literal("add-layer"), clipId: z.string(), layer: layerInput, index: z.number().int().min(0).nullish() }),
  z.object({ op: z.literal("remove-layers"), clipId: z.string(), layerIds: z.array(z.string()).min(1) }),
  z.object({ op: z.literal("reorder-layer"), clipId: z.string(), layerId: z.string(), toIndex: z.number().int().min(0) }),
  z.object({ op: z.literal("duplicate-layers"), clipId: z.string(), layerIds: z.array(z.string()).min(1) }),
  z.object({ op: z.literal("paste-layers"), clipId: z.string(), layers: z.array(clipboardLayer).min(1).max(60) }),
  z.object({ op: z.literal("nudge-layers"), targets: z.array(target).min(1), dxPx: z.number(), dyPx: z.number() }),
  z.object({ op: z.literal("align-layers"), targets: z.array(target).min(1), edge: z.enum(["left", "center", "right", "top", "middle", "bottom"]) }),
  z.object({ op: z.literal("distribute-layers"), targets: z.array(target).min(3), axis: z.enum(["horizontal", "vertical"]) }),
  z.object({ op: z.literal("group-layers"), clipId: z.string(), layerIds: z.array(z.string()).min(2), name: z.string().nullish() }),
  z.object({ op: z.literal("apply-motion-preset"), clipId: z.string(), layerIds: z.array(z.string()).min(1), presetId: z.string(), mode: z.enum(["enter", "exit"]).nullish(), atMs: z.number().nullish(), durationMs: z.number().nullish(), staggerMs: z.number().nullish() }),
  z.object({ op: z.literal("set-transition"), clipId: z.string(), transition: transitionSchema.partial().nullable() }),
  z.object({ op: z.literal("set-marker"), id: z.string().nullish(), atMs: z.number().min(0), label: z.string().max(60).nullish(), color: z.string().nullish() }),
  z.object({ op: z.literal("remove-marker"), id: z.string() }),
  z.object({ op: z.literal("set-track-state"), trackId: z.string(), patch: z.object({ hidden: z.boolean().nullish(), locked: z.boolean().nullish(), muted: z.boolean().nullish(), volume: z.number().min(0).max(2).nullish(), name: z.string().max(60).nullish() }) }),
  z.object({ op: z.literal("set-volume-envelope"), clipId: z.string(), points: z.array(envelopePointSchema).max(512) }),
  z.object({ op: z.literal("set-format"), ratio: z.enum(ASPECT_RATIOS).nullish(), fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).nullish(), title: z.string().max(120).nullish() }),
  z.object({ op: z.literal("set-caption-style"), trackId: z.string().nullish(), style: looseRecord("{ preset: karaoke|clean|pop|boxed|outline, position: bottom|middle|top, positionY (%), font, size, weight, color, highlightColor, background, uppercase }") }),
  z.object({ op: z.literal("update-caption"), clipId: z.string(), text: z.string().max(400) }),
  z.object({ op: z.literal("add-caption"), atMs: z.number().min(0), durationMs: z.number().positive().nullish(), text: z.string().max(400), clipId: z.string().nullish() }),
  z.object({ op: z.literal("set-art-direction"), brief: looseRecord("partial art direction: mood, palette { background, surface, ink, muted, accent }, typePairing, layoutGrid, motionSignature, pacing") }),
]);

export type CompositionOp = z.infer<typeof compositionOpSchema>;
export type CompositionOpInput = z.input<typeof compositionOpSchema>;

/** An op after cleanOp(): no null filler left in optional fields. */
type NoNull<T> = T extends object ? { [K in keyof T]: Exclude<T[K], null> } : T;
type CleanOp = CompositionOp extends infer U ? (U extends unknown ? NoNull<U> : never) : never;

/** Fields where null/empty is meaningful (null removes a field), per op; never cleaned. */
const KEEP_EMPTY: Record<string, string> = { "update-layer": "patch", "update-clip": "patch", "set-caption-style": "style", "set-art-direction": "brief", "set-transition": "transition" };

function isFiller(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value as object).length === 0;
}

/** Drops model filler (null, "", {}, []) from drafts; recursive inside layer/clip/media drafts. */
function stripFiller(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripFiller);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const cleaned = stripFiller(entry);
    if (!isFiller(cleaned)) out[key] = cleaned;
  }
  return out;
}

export function cleanOp<T extends Record<string, unknown>>(op: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(op)) {
    if (KEEP_EMPTY[String(op.op)] === key) {
      out[key] = value;
      continue;
    }
    const cleaned = stripFiller(value);
    if (!isFiller(cleaned)) out[key] = cleaned;
  }
  return out as T;
}

export function applyCompositionOp(composition: Composition, rawOp: CompositionOp): Composition {
  const op = cleanOp(rawOp as Record<string, unknown>) as unknown as CleanOp;
  switch (op.op) {
    case "trim-clip":
      return trimClip(composition, op);
    case "move-clip":
      return moveClip(composition, op);
    case "split-clip":
      return splitClip(composition, op).composition;
    case "delete-clips":
      return deleteClips(composition, op);
    case "add-clip":
      return addClip(composition, { trackId: op.trackId, clip: op.clip as ClipInput, ripple: op.ripple }).composition;
    case "update-clip":
      return updateClip(composition, { clipId: op.clipId, patch: op.patch as ClipPatch });
    case "duplicate-clips":
      return duplicateClips(composition, op).composition;
    case "paste-clips":
      return pasteClips(composition, { atMs: op.atMs, items: op.items.map((item) => ({ trackId: item.trackId ?? undefined, track: item.track, clip: item.clip as ClipInput })) }).composition;
    case "set-clip-speed":
      return setClipSpeed(composition, op);
    case "add-media-clip":
      return addMediaClip(composition, op as Parameters<typeof addMediaClip>[1]).composition;
    case "add-element-clip":
      return addElementClip(composition, { ...op, layer: op.layer as LayerDraft }).composition;
    case "add-track":
      return addTrack(composition, { ...op.track, id: op.id, name: op.name, index: op.index } as Parameters<typeof addTrack>[1]).composition;
    case "remove-track":
      return removeTrack(composition, op);
    case "reorder-track":
      return reorderTrack(composition, op);
    case "set-keyframe":
      return setKeyframe(composition, op);
    case "remove-keyframe":
      return removeKeyframe(composition, op);
    case "move-keyframes":
      return moveKeyframes(composition, op);
    case "update-layer":
      return updateLayer(composition, { clipId: op.clipId, layerId: op.layerId, patch: op.patch as LayerPatch });
    case "add-layer":
      return addLayer(composition, { clipId: op.clipId, layer: op.layer as LayerInput, ...(op.index !== undefined ? { index: op.index } : {}) }).composition;
    case "remove-layers":
      return removeLayers(composition, op);
    case "reorder-layer":
      return reorderLayer(composition, op);
    case "duplicate-layers":
      return duplicateLayers(composition, op).composition;
    case "paste-layers":
      return pasteLayers(composition, { clipId: op.clipId, layers: op.layers as LayerDraft[] }).composition;
    case "nudge-layers":
      return nudgeLayers(composition, op);
    case "align-layers":
      return alignLayers(composition, op);
    case "distribute-layers":
      return distributeLayers(composition, op);
    case "group-layers":
      return groupLayers(composition, op).composition;
    case "apply-motion-preset":
      return applyMotionPreset(composition, op);
    case "set-transition":
      return setTransition(composition, op);
    case "set-marker":
      return setMarker(composition, op);
    case "remove-marker":
      return removeMarker(composition, op);
    case "set-track-state":
      return setTrackState(composition, op as Parameters<typeof setTrackState>[1]);
    case "set-volume-envelope":
      return setVolumeEnvelope(composition, op);
    case "set-format":
      return setFormat(composition, op);
    case "set-caption-style":
      return setCaptionStyle(composition, op);
    case "update-caption":
      return updateCaption(composition, op);
    case "add-caption":
      return addCaption(composition, op).composition;
    case "set-art-direction":
      return setArtDirection(composition, { brief: op.brief as Parameters<typeof setArtDirection>[1]["brief"] });
  }
}

/** Validates and applies a batch in order; throws (and changes nothing) if any op fails. */
export function applyCompositionOps(composition: Composition, ops: ReadonlyArray<CompositionOpInput>): Composition {
  const parsed = z.array(compositionOpSchema).parse(ops);
  return parsed.reduce(applyCompositionOp, composition);
}
