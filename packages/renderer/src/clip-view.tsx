import React from "react";
import type { CSSProperties } from "react";
import { type Transition, type VisualClip, type VisualTrack, clipEndMs, colorBalanceMatrix, colorFilterCss, cssFontStack, hasColorEffects, resolveFontFamily, resolveLayerTransform, vignetteCss } from "@crewcut/composition";
import { MOTION_RULES } from "@crewcut/motion";
import { AbsoluteFill, useVideoConfig } from "remotion";

import { TrackMutedContext, useFrameContext } from "./context";
import { ColorMatrix, LayerView, matrixId } from "./layer-view";
import { fillToCss } from "./styles";
import { hashString } from "./transitions/kit";
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
            layer={layer}
            parentLocalMs={localMs}
            parentDurationMs={localMs > clip.durationMs ? localMs + 1 : clip.durationMs}
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
    />
  );
}
