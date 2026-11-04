import { durationInFrames, formatTimecode, frameToMs, msToFrame } from "@proofcut/composition";
import { ProofcutVideo, loadProofcutFonts } from "@proofcut/renderer";
import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useEditor } from "./editor-store";

/**
 * The live preview is the exact component the render worker draws, so what
 * the editor shows is what exports. Playback and the playhead stay in sync.
 */
export function Preview({ className, burnCaptions }: { className?: string; burnCaptions: boolean }) {
  const composition = useEditor((state) => state.composition);
  const assetUrls = useEditor((state) => state.assetUrls);
  const playheadMs = useEditor((state) => state.playheadMs);
  const playing = useEditor((state) => state.playing);
  const timecodeMode = useEditor((state) => state.timecodeMode);
  const playerRef = useRef<PlayerRef>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const fromPlayer = useRef(false);

  useEffect(() => {
    void loadProofcutFonts();
  }, []);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Player → store while playing.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !composition) return;
    const onFrame = (event: { detail: { frame: number } }) => {
      fromPlayer.current = true;
      useEditor.getState().setPlayhead(frameToMs(event.detail.frame, composition.fps));
    };
    const onPause = () => useEditor.getState().setPlaying(false);
    const onPlay = () => useEditor.getState().setPlaying(true);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onPause);
    player.addEventListener("play", onPlay);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onPause);
      player.removeEventListener("play", onPlay);
    };
  }, [composition]);

  const ready = box.width > 0;
  // Store → player when the playhead is moved by hand (and once the player mounts).
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !composition) return;
    if (fromPlayer.current) {
      fromPlayer.current = false;
      return;
    }
    if (!player.isPlaying()) player.seekTo(msToFrame(playheadMs, composition.fps));
  }, [playheadMs, composition, ready]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (playing && !player.isPlaying()) player.play();
    if (!playing && player.isPlaying()) player.pause();
  }, [playing]);

  const inputProps = useMemo(() => (composition ? { composition, assetUrls, options: { burnCaptions } } : null), [composition, assetUrls, burnCaptions]);
  if (!composition || !inputProps) return <div className={cn("pc-skeleton", className)} />;

  const aspect = composition.width / composition.height;
  const fitted = box.width / Math.max(1, box.height) > aspect ? { width: box.height * aspect, height: box.height } : { width: box.width, height: box.width / aspect };

  return (
    <div ref={boxRef} className={cn("relative flex min-h-0 items-center justify-center overflow-hidden", className)}>
      {fitted.width > 0 ? (
        <div className="relative overflow-hidden rounded-lg shadow-[0_20px_60px_-20px_rgb(0_0_0/0.6),0_0_0_1px_var(--pc-hairline)]" style={{ width: fitted.width, height: fitted.height }}>
          <Player
            ref={playerRef}
            component={ProofcutVideo}
            inputProps={inputProps}
            durationInFrames={durationInFrames(composition.durationMs, composition.fps)}
            fps={composition.fps}
            compositionWidth={composition.width}
            compositionHeight={composition.height}
            style={{ width: "100%", height: "100%" }}
            initialFrame={msToFrame(playheadMs, composition.fps)}
            controls={false}
            clickToPlay={false}
            doubleClickToFullscreen
            acknowledgeRemotionLicense
            initiallyShowControls={false}
          />
          <div className="pc-glass pointer-events-none absolute left-2 top-2 rounded-md px-2 py-1 font-mono text-[11px] tabular text-foreground">
            {formatTimecode(playheadMs, { fps: composition.fps, mode: timecodeMode })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
