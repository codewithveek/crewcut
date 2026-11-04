import React from "react";
import { VIDEO_PRESETS, composeVideo, durationInFrames, parseComposition } from "@proofcut/composition";
import { Composition, type CalculateMetadataFunction } from "remotion";

import { ProofcutVideo, type ProofcutVideoProps, VIDEO_COMPOSITION_ID } from "./video";

const SAMPLE = composeVideo({
  id: "sample",
  title: "Proofcut sample",
  ratio: "16:9",
  seed: 1,
  brief: VIDEO_PRESETS.studio?.brief ?? VIDEO_PRESETS[Object.keys(VIDEO_PRESETS)[0] as string]!.brief,
  scenes: [
    { durationMs: 3000, recipe: { kind: "title", name: "Proofcut", tagline: "Every claim, sourced.", eyebrow: "Introducing" } },
    { durationMs: 3000, recipe: { kind: "big-number", value: 8, label: "Agents", line: "*Five* gates wait for your click" } },
  ],
});

/** Size, fps and duration come from the composition itself (validated at the boundary). */
export const calculateProofcutMetadata: CalculateMetadataFunction<ProofcutVideoProps> = ({ props }) => {
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
      component={ProofcutVideo}
      durationInFrames={durationInFrames(SAMPLE.durationMs, SAMPLE.fps)}
      fps={SAMPLE.fps}
      width={SAMPLE.width}
      height={SAMPLE.height}
      defaultProps={{ composition: SAMPLE, assetUrls: {}, options: {} } satisfies ProofcutVideoProps}
      calculateMetadata={calculateProofcutMetadata}
    />
  );
}
