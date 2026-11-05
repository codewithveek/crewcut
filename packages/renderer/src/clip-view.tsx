import React from "react";
import type { CSSProperties } from "react";
import { type Transition, type VisualClip, type VisualTrack, clipEndMs, colorBalanceMatrix, colorFilterCss, hasColorEffects, resolveLayerTransform, vignetteCss } from "@crewcut/composition";
import { MOTION_RULES, easedSegmentProgress } from "@crewcut/motion";
import { AbsoluteFill, useVideoConfig } from "remotion";

import { TrackMutedContext, useFrameContext } from "./context";
import { ColorMatrix, LayerView, matrixId } from "./layer-view";
import { fillToCss } from "./styles";

/** Styles for the clip entering (`enter`) and leaving (`exit`) at transition progress p. */
export function transitionStyles(transition: Transition, p: number): { enter: CSSProperties; exit: CSSProperties } {
  const vector = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] }[transition.direction] as [number, number];
  const [dx, dy] = vector;
  switch (transition.type) {
    case "cut":
      return { enter: { opacity: p > 0 ? 1 : 0 }, exit: {} };
    case "crossfade":
      return { enter: { opacity: p }, exit: {} };
    case "blur-crossfade": {
      const blur = MOTION_RULES.crossfadeBlurMaxPx * 0.75;
      return {
        enter: { opacity: p, filter: `blur(${((1 - p) * blur).toFixed(2)}px)` },
        exit: { filter: `blur(${(p * blur).toFixed(2)}px)`, opacity: 1 - p * 0.35 },
      };
    }
    case "push":
      return {
        enter: { transform: `translate(${(1 - p) * dx * 100}%, ${(1 - p) * dy * 100}%)` },
        exit: { transform: `translate(${-p * dx * 100}%, ${-p * dy * 100}%)` },
      };
    case "slide":
      return {
        enter: { transform: `translate(${(1 - p) * dx * 100}%, ${(1 - p) * dy * 100}%)`, boxShadow: "0 0 80px rgba(0,0,0,0.35)" },
        exit: { opacity: 1 - p * 0.4, transform: `scale(${1 - p * 0.04})` },
      };
    case "zoom-through":
      return {
        enter: { opacity: p, transform: `scale(${0.92 + 0.08 * p})` },
        exit: { opacity: 1 - p, transform: `scale(${1 + p * 0.5})` },
      };
    case "wipe": {
      const inset = (1 - p) * 100;
      const clip = dx > 0 ? `inset(0 0 0 ${inset}%)` : dx < 0 ? `inset(0 ${inset}% 0 0)` : dy > 0 ? `inset(${inset}% 0 0 0)` : `inset(0 0 ${inset}% 0)`;
      return { enter: { clipPath: clip }, exit: {} };
    }
    case "scale-fade":
      return { enter: { opacity: p, transform: `scale(${0.95 + 0.05 * p})` }, exit: { opacity: 1 - p } };
  }
}

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
  const { options } = useFrameContext();
  const { fps } = useVideoConfig();
  const clips = [...track.clips].sort((a, b) => a.startMs - b.startMs);
  const index = clips.findIndex((clip) => timeMs >= clip.startMs && timeMs < clipEndMs(clip));
  const clip = clips[index];
  if (!clip) return null;
  const sinceStart = timeMs - clip.startMs;
  const previous = clips[index - 1];
  const transition: Transition | undefined = clip.transitionIn
    ? options.reducedMotion
      ? { ...clip.transitionIn, type: "crossfade", durationMs: MOTION_RULES.reducedMotionCrossfadeMs, easing: "standard" }
      : clip.transitionIn
    : undefined;
  const adjacent = previous && Math.abs(clipEndMs(previous) - clip.startMs) <= 1000 / fps + 0.5;
  if (transition && transition.type !== "cut" && transition.durationMs > 0 && sinceStart < transition.durationMs && previous && adjacent) {
    const progress = Math.min(1, Math.max(0, easedSegmentProgress(transition.easing, sinceStart, transition.durationMs)));
    const styles = transitionStyles(transition, progress);
    return (
      <>
        <ClipView clip={previous} localMs={timeMs - previous.startMs} style={styles.exit} isBase={isBase} />
        <ClipView clip={clip} localMs={sinceStart} style={styles.enter} isBase={isBase} />
      </>
    );
  }
  return <ClipView clip={clip} localMs={sinceStart} isBase={isBase} />;
}
