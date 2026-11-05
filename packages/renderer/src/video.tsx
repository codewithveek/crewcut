import React, { useMemo } from "react";
import { type Composition, designScale } from "@crewcut/composition";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

import { AudioTracksView } from "./audio-view";
import { CaptionsView } from "./captions-view";
import { VisualTrackView } from "./clip-view";
import { DEFAULT_RENDER_OPTIONS, FrameContext, type FrameContextValue, type RenderOptions, createSrcResolver } from "./context";

export const VIDEO_COMPOSITION_ID = "crewcut-video";

export interface CrewcutVideoProps extends Record<string, unknown> {
  composition: Composition;
  /** asset id → URL (signed URLs in the studio, file URLs on the render worker). */
  assetUrls?: Record<string, string>;
  options?: Partial<RenderOptions>;
}

/**
 * The single renderer for every composition: the editor's Remotion Player and
 * the render worker both draw this component, so preview equals export.
 */
export function CrewcutVideo({ composition, assetUrls, options }: CrewcutVideoProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const timeMs = (frame * 1000) / fps;
  const context = useMemo<FrameContextValue>(
    () => ({
      composition,
      brief: composition.brief,
      width,
      height,
      scale: designScale(width, height),
      seed: composition.seed,
      options: { ...DEFAULT_RENDER_OPTIONS, ...options },
      resolveSrc: createSrcResolver(assetUrls ?? {}),
    }),
    [composition, width, height, options, assetUrls],
  );
  const visual = composition.tracks.filter((track) => track.kind === "visual" && !track.hidden);
  const captions = composition.tracks.find((track) => track.kind === "caption" && !track.hidden);
  return (
    <FrameContext.Provider value={context}>
      <AbsoluteFill style={{ background: composition.brief.palette.background, overflow: "hidden" }}>
        {visual.map((track, index) =>
          track.kind === "visual" ? <VisualTrackView key={track.id} track={track} timeMs={timeMs} isBase={index === 0} /> : null,
        )}
        {captions?.kind === "caption" && context.options.burnCaptions ? <CaptionsView track={captions} timeMs={timeMs} /> : null}
        <AudioTracksView />
      </AbsoluteFill>
    </FrameContext.Provider>
  );
}
