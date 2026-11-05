import React from "react";
import {
  type AnimatableProperty,
  type Layer,
  type LeafLayer,
  type ResolvedTransform,
  colorBalanceMatrix,
  colorFilterCss,
  hasColorEffects,
  isLayerActive,
  resolveLayerTransform,
  vignetteCss,
} from "@crewcut/composition";
import { useVideoConfig } from "remotion";

import { type FrameContextValue, useFrameContext } from "./context";
import { IconLayerView, ImageLayerView, ShapeLayerView, VideoLayerView } from "./layers/basic-layers";
import { ChartLayerView, CodeLayerView } from "./layers/data-layers";
import { TextLayerView } from "./layers/text-layer";
import { frameStyle } from "./styles";

const POSITIONAL: readonly AnimatableProperty[] = ["x", "y", "offsetX", "offsetY", "scale", "scaleX", "scaleY", "rotation", "rotateX", "rotateY", "blur"];

/** Reduced motion keeps fades and reveals but holds position, scale and blur at their final values. */
function resolveForRender(layer: Layer | LeafLayer, localMs: number, context: FrameContextValue): ResolvedTransform {
  const resolved = resolveLayerTransform(layer, localMs, context.seed);
  if (!context.options.reducedMotion) return resolved;
  for (const property of POSITIONAL) {
    const keyframes = layer.keyframes[property];
    const last = keyframes?.[keyframes.length - 1];
    if (last) (resolved as Record<string, number | undefined>)[property] = last.value;
    else if (property === "offsetX" || property === "offsetY") resolved[property] = layer.transform[property];
  }
  return resolved;
}

export interface LayerViewProps {
  layer: Layer | LeafLayer;
  /** ms since the parent (clip or group) started. */
  parentLocalMs: number;
  parentDurationMs: number;
  /** Absolute frame where the parent starts (for media sync). */
  parentStartFrame: number;
  cameraOffset: { x: number; y: number };
}

export function LayerView({ layer, parentLocalMs, parentDurationMs, parentStartFrame, cameraOffset }: LayerViewProps) {
  const context = useFrameContext();
  const { fps } = useVideoConfig();
  if (layer.type === "camera") return null;
  if (!isLayerActive(layer, parentLocalMs, parentDurationMs)) return null;
  const localMs = parentLocalMs - layer.startMs;
  const transform = resolveForRender(layer, localMs, context);
  const layerStartFrame = parentStartFrame + Math.round((layer.startMs / 1000) * fps);

  if (layer.type === "group") {
    const groupDuration = layer.durationMs ?? parentDurationMs - layer.startMs;
    const panX = (transform.offsetX - cameraOffset.x * layer.depth) * context.scale;
    const panY = (transform.offsetY - cameraOffset.y * layer.depth) * context.scale;
    const scaleX = transform.scale * transform.scaleX;
    const scaleY = transform.scale * transform.scaleY;
    return (
      <div
        data-layer-id={layer.id}
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: `${transform.x}% ${transform.y}%`,
          transform: `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) rotate(${transform.rotation}deg) scale(${(scaleX * (layer.flipX ? -1 : 1)).toFixed(4)}, ${(scaleY * (layer.flipY ? -1 : 1)).toFixed(4)})`,
          opacity: transform.opacity,
          ...(hasColorEffects(layer) || transform.blur > 0.05
            ? { filter: colorFilterCss(layer, { matrixFilterId: matrixId(layer.id), blurPx: transform.blur * context.scale }) }
            : {}),
          mixBlendMode: layer.blendMode === "normal" ? undefined : layer.blendMode,
        }}
      >
        <ColorMatrix id={matrixId(layer.id)} matrix={colorBalanceMatrix(layer.adjust)} />
        {layer.children.map((child) => (
          <LayerView
            key={child.id}
            layer={child}
            parentLocalMs={localMs}
            parentDurationMs={groupDuration}
            parentStartFrame={layerStartFrame}
            cameraOffset={{ x: 0, y: 0 }}
          />
        ))}
      </div>
    );
  }

  const style = frameStyle(transform, {
    width: context.width,
    height: context.height,
    scale: context.scale,
    cameraOffset,
    depth: layer.depth,
  });
  const boxWidth = transform.width !== undefined ? (transform.width / 100) * context.width : 0;
  const boxHeight = transform.height !== undefined ? (transform.height / 100) * context.height : 0;
  // Shapes, media, code and charts need a box; give them a sensible default.
  if ((layer.type === "shape" || layer.type === "image" || layer.type === "video" || layer.type === "code" || layer.type === "chart" || layer.type === "icon") && transform.width === undefined) {
    style.width = context.width * 0.1;
    style.height = context.width * 0.1;
  }
  if (layer.blendMode !== "normal") style.mixBlendMode = layer.blendMode;
  if (layer.flipX || layer.flipY) style.transform = `${style.transform ?? ""} scale(${layer.flipX ? -1 : 1}, ${layer.flipY ? -1 : 1})`;
  if (hasColorEffects(layer)) style.filter = colorFilterCss(layer, { matrixFilterId: matrixId(layer.id), blurPx: transform.blur * context.scale });
  const vignette = layer.type === "image" || layer.type === "video" ? vignetteCss(layer.adjust) : undefined;

  return (
    <div data-layer-id={layer.id} style={style}>
      <ColorMatrix id={matrixId(layer.id)} matrix={colorBalanceMatrix(layer.adjust)} />
      {layer.type === "text" ? <TextLayerView layer={layer} localMs={localMs} /> : null}
      {layer.type === "shape" ? <ShapeLayerView layer={layer} /> : null}
      {layer.type === "image" ? <ImageLayerView layer={layer} /> : null}
      {layer.type === "video" ? <VideoLayerView layer={layer} layerStartFrame={layerStartFrame} /> : null}
      {layer.type === "code" ? <CodeLayerView layer={layer} progress={transform.progress} /> : null}
      {layer.type === "chart" ? <ChartLayerView layer={layer} progress={transform.progress} boxWidth={boxWidth || context.width * 0.1} boxHeight={boxHeight || context.width * 0.1} /> : null}
      {layer.type === "icon" ? <IconLayerView layer={layer} /> : null}
      {vignette ? <div style={{ position: "absolute", inset: 0, background: vignette, borderRadius: "radius" in layer ? layer.radius * context.scale : 0, pointerEvents: "none" }} /> : null}
    </div>
  );
}

export function matrixId(id: string): string {
  return `pc-cb-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** White balance (temperature/tint) as an inline SVG colour matrix referenced by the CSS filter. */
export function ColorMatrix({ id, matrix }: { id: string; matrix: string | null }) {
  if (!matrix) return null;
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute", width: 0, height: 0 }}>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={matrix} />
      </filter>
    </svg>
  );
}
