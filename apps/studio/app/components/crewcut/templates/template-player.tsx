import { type Composition, durationInFrames } from "@crewcut/composition";
import { CrewcutVideo, loadCrewcutFonts } from "@crewcut/renderer";
import { Player, type PlayerRef } from "@remotion/player";
import { type RefObject, useEffect, useMemo, useRef } from "react";

let fontsRequested = false;

/**
 * Plays a template preview (the real renderer, looping). Loaded lazily so the
 * gallery grid only pulls in Remotion when a preview actually plays.
 */
export default function TemplatePlayer({
  composition,
  muted = true,
  playing = true,
  controls = false,
  playerRef,
  assetUrls,
}: {
  composition: Composition;
  /** Links for `asset:<id>` media (saved templates carry their own). */
  assetUrls?: Record<string, string> | undefined;
  muted?: boolean;
  playing?: boolean;
  controls?: boolean;
  /** For a sound button outside the player: unmuting must call `play(event)` inside the click, or the browser keeps it silent. */
  playerRef?: RefObject<PlayerRef | null>;
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
  }, [playing]);
  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    if (muted) player.mute();
    else player.unmute();
  }, [muted]);
  const inputProps = useMemo(() => ({ composition, assetUrls: assetUrls ?? {}, options: { burnCaptions: false } }), [composition, assetUrls]);
  return (
    <Player
      ref={ref}
      component={CrewcutVideo}
      inputProps={inputProps}
      compositionWidth={composition.width}
      compositionHeight={composition.height}
      durationInFrames={durationInFrames(composition.durationMs, composition.fps)}
      fps={composition.fps}
      loop
      autoPlay={playing}
      initiallyMuted={muted}
      controls={controls}
      clickToPlay={controls}
      acknowledgeRemotionLicense
      style={{ width: "100%", height: "100%" }}
    />
  );
}
