import {
  type Composition,
  TRACK_IDS,
  normalizeComposition,
  parseComposition,
} from "@crewcut/composition";
import { type Script, scriptLines } from "@crewcut/contracts";
import {
  type CaptionOptions,
  LONG_FORM_CAPTIONS,
  SHORT_FORM_CAPTIONS,
  type WordTiming,
  buildCaptionCues,
  estimateSpeechMs,
  estimateWordTimings,
  estimatedPeaks,
} from "@crewcut/voice";

/**
 * Narration drives timing by default (Cutroom's solver, in ms): a scene lasts
 * long enough for its lines plus a tail. Clips the user trimmed by hand
 * ("manual") keep their length; their lines still play in order.
 */
/** Voice clips whose audio is only estimated use this src prefix; renderers treat them as silent. */
export const ESTIMATED_AUDIO_PREFIX = "estimated:";

export function isEstimatedAudio(src: string): boolean {
  return src.startsWith(ESTIMATED_AUDIO_PREFIX);
}

export const NARRATION_TIMING = {
  firstLeadMs: 350,
  leadMs: 250,
  gapMs: 180,
  tailMs: 600,
  minSceneMs: 2200,
} as const;

export interface LineAudio {
  lineId: string;
  text: string;
  durationMs: number;
  /** Asset URL; absent while the voice is only estimated. */
  src?: string;
  assetId?: string;
  /** Word timings relative to the line start. */
  words?: WordTiming[];
  peaks?: number[];
  estimated: boolean;
}

export function estimateLineAudio(script: Script): Map<string, LineAudio> {
  const map = new Map<string, LineAudio>();
  for (const line of scriptLines(script)) {
    const durationMs = estimateSpeechMs(line.say ?? line.text, script.wordsPerMinute);
    map.set(line.id, {
      lineId: line.id,
      text: line.text,
      durationMs,
      words: estimateWordTimings(line.text, durationMs),
      peaks: estimatedPeaks(line.text, 48),
      estimated: true,
    });
  }
  return map;
}

export interface TimedSceneInput {
  clipId: string;
  lineIds: string[];
  timing: "narration" | "manual";
  durationMs: number;
  transitionMs: number;
}

export interface SolvedScene {
  clipId: string;
  startMs: number;
  durationMs: number;
  lines: Array<{ lineId: string; startMs: number; durationMs: number }>;
}

export function solveNarrationTiming(
  scenes: readonly TimedSceneInput[],
  lineAudio: ReadonlyMap<string, LineAudio>,
): { scenes: SolvedScene[]; totalMs: number } {
  let cursor = 0;
  let lastLineEnd = Number.NEGATIVE_INFINITY;
  const solved: SolvedScene[] = scenes.map((scene, index) => {
    const startMs = cursor;
    const lead = index === 0 ? NARRATION_TIMING.firstLeadMs : Math.max(NARRATION_TIMING.leadMs, scene.transitionMs * 0.6);
    const lines = scene.lineIds.flatMap((lineId) => {
      const audio = lineAudio.get(lineId);
      if (!audio) return [];
      const lineStart = Math.max(startMs + lead, lastLineEnd + NARRATION_TIMING.gapMs);
      lastLineEnd = lineStart + audio.durationMs;
      return [{ lineId, startMs: Math.round(lineStart), durationMs: Math.round(audio.durationMs) }];
    });
    const lastLine = lines[lines.length - 1];
    const narrationEnd = lastLine ? lastLine.startMs + lastLine.durationMs : startMs;
    const durationMs =
      scene.timing === "manual"
        ? scene.durationMs
        : Math.max(NARRATION_TIMING.minSceneMs, Math.round(narrationEnd - startMs + NARRATION_TIMING.tailMs));
    cursor = startMs + durationMs;
    return { clipId: scene.clipId, startMs, durationMs, lines };
  });
  return { scenes: solved, totalMs: Math.max(cursor, Number.isFinite(lastLineEnd) ? lastLineEnd + NARRATION_TIMING.tailMs : 0) };
}

/**
 * Re-times the scene track from the voice and rebuilds the voice and caption
 * tracks. Overlay clips are left where the user put them.
 */
export function applyNarration(
  composition: Composition,
  lineAudio: ReadonlyMap<string, LineAudio>,
  options: { captions?: CaptionOptions; emphasis?: ReadonlyMap<string, string[]> } = {},
): Composition {
  const draft = structuredClone(composition);
  const sceneTrack = draft.tracks.find((track) => track.id === TRACK_IDS.scenes) ?? draft.tracks.find((track) => track.kind === "visual");
  if (!sceneTrack || sceneTrack.kind !== "visual") return composition;
  const ordered = [...sceneTrack.clips].sort((a, b) => a.startMs - b.startMs);
  const solved = solveNarrationTiming(
    ordered.map((clip) => ({
      clipId: clip.id,
      lineIds: clip.lineIds,
      timing: clip.timing,
      durationMs: clip.durationMs,
      transitionMs: clip.transitionIn?.durationMs ?? 0,
    })),
    lineAudio,
  );
  const byId = new Map(solved.scenes.map((scene) => [scene.clipId, scene]));
  for (const clip of sceneTrack.clips) {
    const scene = byId.get(clip.id);
    if (!scene) continue;
    clip.startMs = scene.startMs;
    clip.durationMs = scene.durationMs;
  }

  const placed = solved.scenes.flatMap((scene) => scene.lines);
  const voiceTrack = draft.tracks.find((track) => track.kind === "audio" && track.role === "voice");
  if (voiceTrack && voiceTrack.kind === "audio") {
    voiceTrack.clips = placed.flatMap((line) => {
      const audio = lineAudio.get(line.lineId);
      if (!audio) return [];
      return [
        {
          id: `voice-${line.lineId}`,
          startMs: line.startMs,
          durationMs: line.durationMs,
          // Estimated narration is a silent placeholder until a voice is synthesized.
          src: audio.src ?? `${ESTIMATED_AUDIO_PREFIX}${line.lineId}`,
          trimStartMs: 0,
          volume: 1,
          playbackRate: 1,
          fadeInMs: 0,
          fadeOutMs: 0,
          envelope: [],
          duckUnderVoice: false,
          lineId: line.lineId,
          text: audio.text,
          peaks: audio.peaks ?? [],
          ...(audio.assetId ? { assetId: audio.assetId } : {}),
        },
      ];
    });
  }

  const captionTrack = draft.tracks.find((track) => track.kind === "caption");
  if (captionTrack && captionTrack.kind === "caption") {
    const captionOptions = options.captions ?? (draft.ratio === "16:9" ? LONG_FORM_CAPTIONS : SHORT_FORM_CAPTIONS);
    const cues = placed.flatMap((line) => {
      const audio = lineAudio.get(line.lineId);
      if (!audio) return [];
      const words = (audio.words ?? estimateWordTimings(audio.text, audio.durationMs)).map((word) => ({
        text: word.text,
        startMs: word.startMs + line.startMs,
        endMs: word.endMs + line.startMs,
      }));
      return buildCaptionCues(words, captionOptions, options.emphasis?.get(line.lineId) ?? []);
    });
    captionTrack.clips = cues.map((cue, index) => ({
      id: `caption-${index + 1}`,
      startMs: cue.startMs,
      durationMs: Math.max(1, cue.endMs - cue.startMs),
      text: cue.text,
      words: cue.words,
      emphasis: cue.emphasis,
    }));
    // Captions must not overlap each other.
    captionTrack.clips.forEach((clip, index) => {
      const next = captionTrack.clips[index + 1];
      if (next && clip.startMs + clip.durationMs > next.startMs) clip.durationMs = Math.max(1, next.startMs - clip.startMs);
    });
  }

  const musicTrack = draft.tracks.find((track) => track.kind === "audio" && track.role === "music");
  const total = Math.max(...solved.scenes.map((scene) => scene.startMs + scene.durationMs), 1);
  if (musicTrack && musicTrack.kind === "audio") {
    for (const clip of musicTrack.clips) if (clip.startMs === 0) clip.durationMs = total;
  }
  return parseComposition(normalizeComposition(draft));
}
