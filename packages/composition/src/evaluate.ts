import { ambientOffset, evaluateKeyframes } from "@proofcut/motion";

import type { AnimatableProperty, Keyframe, KeyframeMap, Layer, LeafLayer, Transform } from "./schema";

export type ResolvedTransform = Required<Omit<Transform, "width" | "height">> & {
  width: number | undefined;
  height: number | undefined;
};

const NUMERIC_DEFAULTS: Record<AnimatableProperty, number> = {
  x: 50,
  y: 50,
  width: 0,
  height: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  rotateX: 0,
  rotateY: 0,
  opacity: 1,
  blur: 0,
  offsetX: 0,
  offsetY: 0,
  clipTop: 0,
  clipRight: 0,
  clipBottom: 0,
  clipLeft: 0,
  progress: 1,
};

export function baseValue(transform: Transform, property: AnimatableProperty): number {
  const value = transform[property];
  return typeof value === "number" ? value : NUMERIC_DEFAULTS[property];
}

export function evaluateProperty(
  transform: Transform,
  keyframes: KeyframeMap,
  property: AnimatableProperty,
  layerLocalMs: number,
): number {
  const track = keyframes[property] as Keyframe[] | undefined;
  return evaluateKeyframes(track, layerLocalMs, baseValue(transform, property));
}

/**
 * The layer's transform at `layerLocalMs` (ms since the layer started):
 * base transform, overridden by keyframes, plus ambient motion.
 */
export function resolveLayerTransform(layer: Layer | LeafLayer, layerLocalMs: number, seed: number): ResolvedTransform {
  const { transform, keyframes } = layer;
  const value = (property: AnimatableProperty) => evaluateProperty(transform, keyframes, property, layerLocalMs);
  const resolved: ResolvedTransform = {
    x: value("x"),
    y: value("y"),
    width: keyframes.width?.length ? value("width") : transform.width,
    height: keyframes.height?.length ? value("height") : transform.height,
    anchorX: transform.anchorX,
    anchorY: transform.anchorY,
    originX: transform.originX,
    originY: transform.originY,
    scale: value("scale"),
    scaleX: value("scaleX"),
    scaleY: value("scaleY"),
    rotation: value("rotation"),
    rotateX: value("rotateX"),
    rotateY: value("rotateY"),
    opacity: clamp(value("opacity"), 0, 1),
    blur: Math.max(0, value("blur")),
    offsetX: value("offsetX"),
    offsetY: value("offsetY"),
    clipTop: clamp(value("clipTop"), 0, 100),
    clipRight: clamp(value("clipRight"), 0, 100),
    clipBottom: clamp(value("clipBottom"), 0, 100),
    clipLeft: clamp(value("clipLeft"), 0, 100),
    progress: clamp(value("progress"), 0, 1),
  };
  if (layer.ambient) {
    const ambient = ambientOffset(layer.ambient, layerLocalMs, `${seed}:${layer.id}`);
    resolved.offsetX += ambient.offsetX;
    resolved.offsetY += ambient.offsetY;
    resolved.scale *= ambient.scale;
    resolved.rotation += ambient.rotation;
  }
  return resolved;
}

/** Is the layer on screen at `clipLocalMs` (ms since its clip started)? */
export function isLayerActive(
  layer: { startMs: number; durationMs?: number | undefined; hidden: boolean },
  clipLocalMs: number,
  clipDurationMs: number,
): boolean {
  if (layer.hidden) return false;
  if (clipLocalMs < layer.startMs) return false;
  const end = layer.durationMs === undefined ? clipDurationMs : layer.startMs + layer.durationMs;
  return clipLocalMs < end;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
