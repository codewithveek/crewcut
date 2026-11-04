import React from "react";
import { type AudioClip, type AudioTrack, type Composition, clipEndMs } from "@proofcut/composition";
import { Html5Audio, Sequence, useVideoConfig } from "remotion";

import { useFrameContext } from "./context";

/** Music sits ~10 dB under the voice and ramps over 200 ms (vid-skills' sound plan). */
export const DUCK_LEVEL = 0.32;
const DUCK_RAMP_MS = 200;

export function voiceIntervals(composition: Composition): Array<[number, number]> {
  return composition.tracks
    .filter((track): track is AudioTrack => track.kind === "audio" && track.role === "voice" && !track.muted)
    .flatMap((track) => track.clips.map((clip) => [clip.startMs, clipEndMs(clip)] as [number, number]))
    .sort((a, b) => a[0] - b[0]);
}

export function duckFactor(intervals: ReadonlyArray<[number, number]>, timeMs: number): number {
  let factor = 1;
  for (const [start, end] of intervals) {
    if (timeMs >= start && timeMs <= end) return DUCK_LEVEL;
    const distance = timeMs < start ? start - timeMs : timeMs - end;
    if (distance < DUCK_RAMP_MS) factor = Math.min(factor, DUCK_LEVEL + (1 - DUCK_LEVEL) * (distance / DUCK_RAMP_MS));
  }
  return factor;
}

export function envelopeGain(clip: AudioClip, clipLocalMs: number): number {
  let gain = clip.volume;
  if (clip.fadeInMs > 0) gain *= Math.min(1, clipLocalMs / clip.fadeInMs);
  if (clip.fadeOutMs > 0) gain *= Math.min(1, Math.max(0, clip.durationMs - clipLocalMs) / clip.fadeOutMs);
  const points = clip.envelope;
  if (points.length > 0) {
    const right = points.findIndex((point) => point.atMs >= clipLocalMs);
    if (right === -1) gain *= points[points.length - 1]?.value ?? 1;
    else if (right === 0) gain *= points[0]?.value ?? 1;
    else {
      const a = points[right - 1];
      const b = points[right];
      if (a && b) gain *= a.value + ((b.value - a.value) * (clipLocalMs - a.atMs)) / Math.max(1, b.atMs - a.atMs);
    }
  }
  return Math.max(0, Math.min(2, gain));
}

export function AudioTracksView() {
  const { composition, resolveSrc } = useFrameContext();
  const { fps } = useVideoConfig();
  const intervals = voiceIntervals(composition);
  return (
    <>
      {composition.tracks.map((track) => {
        if (track.kind !== "audio" || track.muted) return null;
        return track.clips.map((clip) => {
          const src = resolveSrc(clip.src);
          if (!src) return null;
          const from = Math.round((clip.startMs / 1000) * fps);
          const durationInFrames = Math.max(1, Math.round((clip.durationMs / 1000) * fps));
          return (
            <Sequence key={clip.id} from={from} durationInFrames={durationInFrames} layout="none">
              <Html5Audio
                src={src}
                trimBefore={Math.round((clip.trimStartMs / 1000) * fps)}
                volume={(frame) => {
                  const localMs = (frame / fps) * 1000;
                  const duck = clip.duckUnderVoice ? duckFactor(intervals, clip.startMs + localMs) : 1;
                  return track.volume * envelopeGain(clip, localMs) * duck;
                }}
              />
            </Sequence>
          );
        });
      })}
    </>
  );
}
