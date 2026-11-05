import { type Composition, durationInFrames, msToFrame } from "@crewcut/composition";
import { CrewcutVideo, loadCrewcutFonts } from "@crewcut/renderer";
import { Thumbnail } from "@remotion/player";
import { useEffect, useMemo } from "react";

let fontsRequested = false;

/** A frame a viewer would recognise: past the first entrances, never past the end. */
function posterFrame(composition: Composition): number {
  const atMs = Math.min(Math.max(composition.durationMs * 0.22, 900), 2600, composition.durationMs - 1);
  return Math.max(0, msToFrame(atMs, composition.fps));
}

/** The Remotion half of VideoThumb, loaded on demand so pages never wait for the renderer. */
export default function VideoThumbFrame({ composition, assetUrls }: { composition: Composition; assetUrls: Record<string, string> }) {
  useEffect(() => {
    if (fontsRequested) return;
    fontsRequested = true;
    void loadCrewcutFonts();
  }, []);
  const inputProps = useMemo(() => ({ composition, assetUrls, options: { burnCaptions: false } }), [composition, assetUrls]);
  return (
    <Thumbnail
      component={CrewcutVideo}
      inputProps={inputProps}
      compositionWidth={composition.width}
      compositionHeight={composition.height}
      durationInFrames={durationInFrames(composition.durationMs, composition.fps)}
      fps={composition.fps}
      frameToDisplay={posterFrame(composition)}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
