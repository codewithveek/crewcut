import { type Composition, durationInFrames } from "@crewcut/composition";
import { CrewcutVideo, loadCrewcutFonts } from "@crewcut/renderer";
import { Player, type PlayerRef } from "@remotion/player";
import { type RefObject, useEffect, useMemo, useRef } from "react";

let fontsRequested = false;

/**
 * The real renderer playing a template on the landing page (muted, looping).
 * Loaded lazily so the page's first paint never waits for Remotion.
 */
export default function LandingPlayer({
  composition,
  playing,
  initialFrame = 0,
  playerRef,
  label,
}: {
  composition: Composition;
  playing: boolean;
  initialFrame?: number;
  playerRef?: RefObject<PlayerRef | null>;
  label: string;
}) {
  const ownRef = useRef<PlayerRef>(null);
  const ref = playerRef ?? ownRef;
  useEffect(() => {
    if (fontsRequested) return;
    fontsRequested = true;
    void loadCrewcutFonts();
  }, []);
  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    if (playing) player.play();
    else player.pause();
  }, [playing, ref]);
  const inputProps = useMemo(() => ({ composition, assetUrls: {}, options: { burnCaptions: false } }), [composition]);
  const frames = durationInFrames(composition.durationMs, composition.fps);
  return (
    <div role="img" aria-label={label} className="h-full w-full">
      <Player
        ref={ref}
        component={CrewcutVideo}
        inputProps={inputProps}
        compositionWidth={composition.width}
        compositionHeight={composition.height}
        durationInFrames={frames}
        fps={composition.fps}
        initialFrame={Math.min(frames - 1, Math.max(0, initialFrame))}
        loop
        autoPlay={playing}
        initiallyMuted
        controls={false}
        clickToPlay={false}
        acknowledgeRemotionLicense
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
