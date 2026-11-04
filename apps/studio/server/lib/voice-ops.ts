import type { Composition } from "@proofcut/composition";
import type { Script } from "@proofcut/contracts";
import { type LineAudio, estimateLineAudio } from "@proofcut/pipeline";

/**
 * Line audio for re-timing: real synthesized voice where a voice clip exists
 * in the composition, estimates everywhere else.
 */
export function lineAudioFor(script: Script, composition: Composition | null): Map<string, LineAudio> {
  const audio = estimateLineAudio(script);
  const voiceTrack = composition?.tracks.find((track) => track.kind === "audio" && track.role === "voice");
  if (voiceTrack?.kind === "audio") {
    for (const clip of voiceTrack.clips) {
      if (!clip.lineId || clip.src.startsWith("estimated:")) continue;
      const estimate = audio.get(clip.lineId);
      if (!estimate) continue;
      audio.set(clip.lineId, {
        ...estimate,
        durationMs: clip.durationMs,
        src: clip.src,
        ...(clip.assetId ? { assetId: clip.assetId } : {}),
        peaks: clip.peaks,
        estimated: false,
      });
    }
  }
  return audio;
}
