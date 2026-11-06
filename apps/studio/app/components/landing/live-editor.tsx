import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useInView, usePrefersReducedMotion } from "./use-landing";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * One frame of the real editor: a 1440×900 capture with the video, playhead
 * and chat hidden, plus where they sat (percent of the image) and the
 * template rendered to MP4 for that spot.
 */
export interface EditorShot {
  key: string;
  image: string;
  video: string;
  stage: Box;
  playhead: { x0: number; top: number; bottom: number; msWidth: number };
}

/** The editor's own play button (same place in every capture at 1440×900). */
const PLAY_BUTTON = { left: (742 / 1440) * 100, top: (530 / 900) * 100, size: (32 / 1440) * 100 };

const pct = (value: number) => `${value}%`;

/**
 * The editor, live: the screenshot with the real video playing in its preview,
 * a playhead running along its timeline and a working play/pause button.
 * Videos play straight from the server-rendered page, before any script runs.
 */
export function LiveEditor({
  shots,
  active,
  tone,
  label,
  alt,
  children,
}: {
  shots: EditorShot[];
  active: string;
  /** The editor's theme in the captures: its play button is light on dark, dark on light. */
  tone: "dark" | "light";
  label: string;
  alt: string;
  children?: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const visible = useInView(frameRef);
  const reduced = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const shot = shots.find((entry) => entry.key === active) ?? shots[0];

  // Reduced motion: start paused (the visitor can still press play).
  useEffect(() => {
    if (reduced) setUserPaused(true);
  }, [reduced]);

  // Only the active video plays, and only while on screen and not paused by the visitor.
  useEffect(() => {
    for (const [key, video] of videos.current) {
      if (key !== active) {
        video.pause();
        continue;
      }
      if (visible && !userPaused) void video.play().catch(() => undefined);
      else video.pause();
    }
  }, [active, visible, userPaused]);

  // A switched-in video starts from the top, like a fresh cut.
  const previous = useRef(active);
  useEffect(() => {
    if (previous.current === active) return;
    previous.current = active;
    const video = videos.current.get(active);
    if (video) video.currentTime = 0;
  }, [active]);

  return (
    <div ref={frameRef} className="lp-demo" data-tone={tone} role="group" aria-label={label}>
      {shots.map((entry) => (
        <img
          key={entry.key}
          src={entry.image}
          alt={entry.key === shots[0]?.key ? alt : ""}
          className="lp-demo-shot"
          data-active={entry.key === active || undefined}
          width={2880}
          height={1800}
          decoding="async"
          fetchPriority={entry.key === shots[0]?.key ? "high" : "low"}
        />
      ))}
      {shots.map((entry) => (
        <div
          key={entry.key}
          className="lp-demo-screen"
          data-active={entry.key === active || undefined}
          style={{ left: pct(entry.stage.left), top: pct(entry.stage.top), width: pct(entry.stage.width), height: pct(entry.stage.height) }}
        >
          <video
            ref={(element) => {
              if (element) videos.current.set(entry.key, element);
              else videos.current.delete(entry.key);
            }}
            src={entry.video}
            muted
            loop
            playsInline
            autoPlay={entry.key === active}
            preload={entry.key === active ? "auto" : "metadata"}
            onPlay={() => entry.key === active && setPaused(false)}
            onPause={() => entry.key === active && setPaused(true)}
            aria-hidden
          />
        </div>
      ))}
      {shot ? <Playhead video={() => videos.current.get(shot.key)} box={shot.playhead} /> : null}
      <button
        type="button"
        className="lp-demo-play"
        style={{ left: pct(PLAY_BUTTON.left), top: pct(PLAY_BUTTON.top), width: pct(PLAY_BUTTON.size) }}
        aria-label={paused ? "Play the video" : "Pause the video"}
        onClick={() => setUserPaused(!paused)}
      >
        {paused ? <IconPlayerPlayFilled aria-hidden /> : <IconPlayerPauseFilled aria-hidden />}
      </button>
      {children}
    </div>
  );
}

/** A playhead on the editor's own timeline, following the active video. */
function Playhead({ video, box }: { video: () => HTMLVideoElement | undefined; box: EditorShot["playhead"] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const loop = () => {
      const element = video();
      if (element && ref.current) ref.current.style.transform = `translateX(${element.currentTime * 1000 * box.msWidth}cqw)`;
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [video, box.msWidth]);
  return <div ref={ref} className="lp-demo-playhead" style={{ left: pct(box.x0), top: pct(box.top), bottom: pct(box.bottom) }} aria-hidden />;
}
