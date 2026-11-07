import React from "react";
import type { CSSProperties } from "react";
import { type Transition, type VisualClip, type VisualTrack, clipEndMs, colorBalanceMatrix, colorFilterCss, cssFontStack, hasColorEffects, resolveFontFamily, resolveLayerTransform, vignetteCss } from "@crewcut/composition";
import { MOTION_RULES } from "@crewcut/motion";
import { AbsoluteFill, useVideoConfig } from "remotion";

import { TrackMutedContext, useFrameContext } from "./context";
import { ColorMatrix, LayerView, matrixId } from "./layer-view";
import { fillToCss } from "./styles";
import { hashString } from "./transitions/kit";
import type { ContentBox } from "./transitions/effects";
import { TransitionStage } from "./transitions/stage";

function ClipView({ clip, localMs, style, isBase }: { clip: VisualClip; localMs: number; style?: CSSProperties; isBase: boolean }) {
  const context = useFrameContext();
  const { fps } = useVideoConfig();
  const camera = clip.layers.find((layer) => layer.type === "camera");
  const cameraTransform = camera ? resolveLayerTransform(camera, localMs - camera.startMs, context.seed) : null;
  const perspective = camera?.type === "camera" ? camera.perspective * context.scale : 1600;
  const background = fillToCss(clip.background) ?? (isBase ? context.brief.palette.background : undefined);
  const cameraStyle: CSSProperties | undefined = cameraTransform
    ? {
        transform: `perspective(${perspective}px) rotateX(${cameraTransform.rotateX}deg) rotateY(${cameraTransform.rotateY}deg) rotate(${cameraTransform.rotation}deg) scale(${cameraTransform.scale})`,
        transformOrigin: "50% 50%",
      }
    : undefined;
  const colored = hasColorEffects(clip);
  const clipMatrixId = matrixId(`clip-${clip.id}`);
  const vignette = vignetteCss(clip.adjust);
  const colorFilter = colored ? colorFilterCss(clip, { matrixFilterId: clipMatrixId }) : undefined;
  return (
    <AbsoluteFill data-clip-id={clip.id} style={{ background, overflow: "hidden", ...style, ...(colorFilter ? { filter: [style?.filter, colorFilter].filter(Boolean).join(" ") } : {}) }}>
      <ColorMatrix id={clipMatrixId} matrix={colorBalanceMatrix(clip.adjust)} />
      <AbsoluteFill style={cameraStyle}>
        {clip.layers.map((layer) => (
          <LayerView
            key={layer.id}
            // Held past its end as a transition's outgoing clip: layers that ran to the clip's
            // end stay on screen (from the very first frame — at exactly the end they'd count as over).
            layer={localMs >= clip.durationMs && layer.durationMs !== undefined && layer.startMs + layer.durationMs >= clip.durationMs - 1 ? { ...layer, durationMs: undefined } : layer}
            parentLocalMs={localMs}
            parentDurationMs={localMs >= clip.durationMs ? localMs + 1 : clip.durationMs}
            parentStartFrame={Math.round((clip.startMs / 1000) * fps)}
            cameraOffset={cameraTransform ? { x: cameraTransform.offsetX, y: cameraTransform.offsetY } : { x: 0, y: 0 }}
          />
        ))}
      </AbsoluteFill>
      {vignette ? <AbsoluteFill style={{ background: vignette, pointerEvents: "none" }} /> : null}
    </AbsoluteFill>
  );
}

/**
 * Renders the clip under the playhead. A clip with `transitionIn` overlaps
 * the end of the clip before it: the outgoing clip keeps running (its layers
 * hold their end state) while the incoming one enters.
 */
export function VisualTrackView({ track, timeMs, isBase }: { track: VisualTrack; timeMs: number; isBase: boolean }) {
  return (
    <TrackMutedContext.Provider value={track.muted}>
      <VisualTrackClips track={track} timeMs={timeMs} isBase={isBase} />
    </TrackMutedContext.Provider>
  );
}

/**
 * What a clip draws (px), or null when it fills the frame (a base clip, one
 * with a background, or a layer whose size we can't tell): the union of its
 * layers' boxes. Text without a set size is estimated from its font size,
 * line count and wrap width — generous, since this only bounds effects.
 */
function clipContentBox(clip: VisualClip, isBase: boolean, width: number, height: number, scale: number): ContentBox | null {
  if (isBase || clip.background) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const layer of clip.layers) {
    if (layer.type === "camera" || layer.hidden) continue;
    const transform = layer.transform;
    const scaleX = Math.abs((transform.scale ?? 1) * (transform.scaleX ?? 1));
    const scaleY = Math.abs((transform.scale ?? 1) * (transform.scaleY ?? 1));
    let boxW: number | null = transform.width !== undefined ? (transform.width / 100) * width : null;
    let boxH: number | null = transform.height !== undefined ? (transform.height / 100) * height : null;
    if (layer.type === "text") {
      const lines = layer.text.split("\n");
      const longest = Math.max(...lines.map((line) => line.replace(/\*/g, "").length), 1);
      const wrap = (layer.style.maxWidth / 100) * width;
      boxW ??= Math.min(wrap, longest * layer.style.size * scale * 0.62);
      boxH ??= layer.style.size * scale * 1.3 * Math.max(lines.length, Math.ceil((longest * layer.style.size * scale * 0.62) / Math.max(1, wrap)));
    }
    if (boxW === null || boxH === null) return null;
    boxW *= scaleX;
    boxH *= scaleY;
    const layerLeft = (transform.x / 100) * width - (transform.anchorX ?? 0.5) * boxW;
    const layerTop = (transform.y / 100) * height - (transform.anchorY ?? 0.5) * boxH;
    left = Math.min(left, layerLeft);
    top = Math.min(top, layerTop);
    right = Math.max(right, layerLeft + boxW);
    bottom = Math.max(bottom, layerTop + boxH);
  }
  return Number.isFinite(left) && right > left && bottom > top ? { left, top, right, bottom } : null;
}

function VisualTrackClips({ track, timeMs, isBase }: { track: VisualTrack; timeMs: number; isBase: boolean }) {
  const context = useFrameContext();
  const { fps } = useVideoConfig();
  const clips = [...track.clips].sort((a, b) => a.startMs - b.startMs);
  const index = clips.findIndex((clip) => timeMs >= clip.startMs && timeMs < clipEndMs(clip));
  const clip = clips[index];
  if (!clip) return null;
  const sinceStart = timeMs - clip.startMs;
  const previous = clips[index - 1];
  const transition: Transition | undefined = clip.transitionIn
    ? context.options.reducedMotion
      ? { ...clip.transitionIn, type: "crossfade", durationMs: MOTION_RULES.reducedMotionCrossfadeMs, easing: "standard" }
      : clip.transitionIn
    : undefined;
  const adjacent = previous && Math.abs(clipEndMs(previous) - clip.startMs) <= 1000 / fps + 0.5;
  const transitioning = Boolean(transition && transition.type !== "cut" && transition.durationMs > 0 && sinceStart < transition.durationMs && previous && adjacent);
  // Elements (clips that don't fill the frame) keep a transition's graphics to their own boxes.
  const exitBox = transitioning && previous ? clipContentBox(previous, isBase, context.width, context.height, context.scale) : null;
  const enterBox = transitioning ? clipContentBox(clip, isBase, context.width, context.height, context.scale) : null;
  const boxes = exitBox && enterBox ? { exitBox, enterBox, transparent: true } : {};
  return (
    <TransitionStage
      enterKey={clip.id}
      enter={<ClipView clip={clip} localMs={sinceStart} isBase={isBase} />}
      exitKey={transitioning && previous ? previous.id : undefined}
      exit={transitioning && previous ? <ClipView clip={previous} localMs={timeMs - previous.startMs} isBase={isBase} /> : undefined}
      transition={transitioning ? transition : null}
      t={transition && transition.durationMs > 0 ? sinceStart / transition.durationMs : 1}
      width={context.width}
      height={context.height}
      palette={context.brief.palette}
      seed={(context.seed + hashString(clip.id)) >>> 0}
      frame={Math.round((timeMs * fps) / 1000)}
      fontFamily={cssFontStack(resolveFontFamily("display", context.brief.typePairing))}
      idPrefix={`tr-${track.id}-${clip.id}`}
      {...boxes}
    />
  );
}
