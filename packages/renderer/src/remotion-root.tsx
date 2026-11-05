import React from "react";
import { VIDEO_PRESETS, composeVideo, durationInFrames, parseComposition } from "@crewcut/composition";
import { Composition, type CalculateMetadataFunction } from "remotion";

import { CrewcutVideo, type CrewcutVideoProps, VIDEO_COMPOSITION_ID } from "./video";

const SAMPLE = composeVideo({
  id: "sample",
  title: "Crewcut sample",
  ratio: "16:9",
  seed: 1,
  brief: VIDEO_PRESETS.studio?.brief ?? VIDEO_PRESETS[Object.keys(VIDEO_PRESETS)[0] as string]!.brief,
  scenes: [
    { durationMs: 3000, recipe: { kind: "title", name: "Crewcut", tagline: "Every claim, sourced.", eyebrow: "Introducing" } },
    { durationMs: 3000, recipe: { kind: "big-number", value: 8, label: "Agents", line: "*Five* gates wait for your click" } },
  ],
});

/** Size, fps and duration come from the composition itself (validated at the boundary). */
export const calculateCrewcutMetadata: CalculateMetadataFunction<CrewcutVideoProps> = ({ props }) => {
  const composition = parseComposition(props.composition);
  return {
    props: { ...props, composition },
    fps: composition.fps,
    width: composition.width,
    height: composition.height,
    durationInFrames: durationInFrames(composition.durationMs, composition.fps),
  };
};

export function RemotionRoot() {
  return (
    <Composition
      id={VIDEO_COMPOSITION_ID}
      component={CrewcutVideo}
      durationInFrames={durationInFrames(SAMPLE.durationMs, SAMPLE.fps)}
      fps={SAMPLE.fps}
      width={SAMPLE.width}
      height={SAMPLE.height}
      defaultProps={{ composition: SAMPLE, assetUrls: {}, options: {} } satisfies CrewcutVideoProps}
      calculateMetadata={calculateCrewcutMetadata}
    />
  );
}
