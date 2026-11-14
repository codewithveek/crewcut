import type { AnyClip, Composition, CompositionOpInput } from "@crewcut/composition";
import { LONG_FORM_CAPTIONS, SHORT_FORM_CAPTIONS, type WordPlacement, type WordTiming, buildCaptionCues, placeWords } from "@crewcut/voice";

/**
 * Captions from what is said in a video's own media: which clips have
 * speech worth captioning, and the edit that writes their words onto the
 * caption track. Pure, so it is re-run on top of a newer version when two
 * edits race.
 */

export interface SpeechSource {
  clipId: string;
  layerId?: string;
  assetId: string;
  label: string;
  placement: Omit<WordPlacement, "loopSourceMs">;
  loop: boolean;
}

const assetIdOf = (src: string): string | null => (src.startsWith("asset:") ? src.slice(6) || null : null);

/**
 * Media whose speech can be captioned. With a clipId: that clip (an audio
 * clip, or the video layers of a visual clip, optionally one layer). Without:
 * every video layer people can hear and every recorded voice clip; music,
 * sound effects, muted tracks and generated narration (it already has its
 * words) are left out.
 */
export function speechSources(composition: Composition, target: { clipId?: string; layerId?: string } = {}): SpeechSource[] {
  const sources: SpeechSource[] = [];
  for (const track of composition.tracks) {
    if (track.kind === "caption") continue;
    for (const clip of track.clips as AnyClip[]) {
      if (target.clipId && clip.id !== target.clipId) continue;
      const clipEnd = clip.startMs + clip.durationMs;
      if (track.kind === "audio") {
        if (!("src" in clip)) continue;
        const assetId = assetIdOf(clip.src);
        if (!assetId) continue;
        if (!target.clipId && (track.role !== "voice" || track.muted || clip.lineId || clip.volume <= 0)) continue;
        sources.push({
          clipId: clip.id,
          assetId,
          label: clip.text?.trim() || clip.name || "Audio",
          placement: { trimStartMs: clip.trimStartMs, playbackRate: clip.playbackRate, timelineStartMs: clip.startMs, windowStartMs: clip.startMs, windowEndMs: clipEnd },
          loop: false,
        });
        continue;
      }
      if (track.kind !== "visual" || !("layers" in clip)) continue;
      if (!target.clipId && track.muted) continue;
      for (const layer of clip.layers) {
        if (layer.type !== "video") continue;
        if (target.layerId && layer.id !== target.layerId) continue;
        if (!target.clipId && layer.volume <= 0) continue;
        const assetId = assetIdOf(layer.src);
        if (!assetId) continue;
        const begins = clip.startMs + layer.startMs;
        const ends = layer.durationMs ? Math.min(clipEnd, begins + layer.durationMs) : clipEnd;
        const windowStartMs = Math.max(clip.startMs, begins);
        if (ends <= windowStartMs) continue;
        sources.push({
          clipId: clip.id,
          layerId: layer.id,
          assetId,
          label: layer.name || clip.name || "Video",
          placement: { trimStartMs: layer.trimStartMs, playbackRate: layer.playbackRate, timelineStartMs: begins, windowStartMs, windowEndMs: ends },
          loop: layer.loop,
        });
      }
    }
  }
  return sources;
}

/** Long lines read better on wide videos; short, punchy ones on vertical and square. */
export function captionStyleFor(ratio: string) {
  const [w = 16, h = 9] = ratio.split(":").map(Number);
  return w > h ? LONG_FORM_CAPTIONS : SHORT_FORM_CAPTIONS;
}

let counter = 0;
const captionId = () => `cap-sp-${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * The edit: make sure there's a caption track, remove the captions that sit
 * where these clips play, and add cues for their words. Cues never overlap
 * each other, the captions kept elsewhere, or run past the video's end.
 */
export function speechCaptionOps(
  composition: Composition,
  placed: ReadonlyArray<{ windowStartMs: number; windowEndMs: number; words: readonly WordTiming[] }>,
): { ops: CompositionOpInput[]; cues: number; words: number } {
  const ops: CompositionOpInput[] = [];
  const existing = composition.tracks.find((track) => track.kind === "caption");
  let trackId = existing?.id;
  if (!trackId) {
    const taken = new Set(composition.tracks.map((track) => track.id));
    trackId = "track-captions";
    for (let n = 2; taken.has(trackId); n += 1) trackId = `track-captions-${n}`;
    ops.push({ op: "add-track", track: { kind: "caption" }, id: trackId });
  }
  const overlapsWindow = (start: number, end: number) => placed.some((window) => start < window.windowEndMs && end > window.windowStartMs);
  const kept = (existing?.clips ?? []).filter((clip) => !overlapsWindow(clip.startMs, clip.startMs + clip.durationMs));
  const removed = (existing?.clips ?? []).filter((clip) => !kept.includes(clip));
  if (removed.length) ops.push({ op: "delete-clips", clipIds: removed.map((clip) => clip.id) });

  const words = placed.flatMap((entry) => entry.words).sort((a, b) => a.startMs - b.startMs);
  const cues = buildCaptionCues(words, captionStyleFor(composition.ratio));
  // Everything a new cue must stop before: the next cue, a kept caption, the end of the video.
  const blockers = kept.map((clip) => clip.startMs).sort((a, b) => a - b);
  let added = 0;
  let previousEnd = 0;
  for (const [index, cue] of cues.entries()) {
    const startMs = Math.max(Math.round(cue.startMs), previousEnd);
    if (kept.some((clip) => startMs >= clip.startMs && startMs < clip.startMs + clip.durationMs)) continue;
    const nextCue = cues[index + 1];
    const limit = Math.min(
      composition.durationMs,
      nextCue ? Math.round(nextCue.startMs) : Number.POSITIVE_INFINITY,
      blockers.find((start) => start > startMs) ?? Number.POSITIVE_INFINITY,
    );
    const endMs = Math.min(limit, Math.max(startMs + 200, Math.round(cue.endMs)));
    if (endMs - startMs < 1) continue;
    // A cue cut short keeps only the words that still start inside it.
    const shown = cue.words.flatMap((word, wordIndex) => {
      const wordStart = Math.max(startMs, Math.round(word.startMs));
      if (wordStart >= endMs) return [];
      return [{ wordIndex, word: { text: word.text, startMs: wordStart, endMs: Math.min(endMs, Math.max(Math.round(word.endMs), wordStart)) } }];
    });
    if (shown.length === 0) continue;
    ops.push({
      op: "add-clip",
      trackId,
      clip: {
        id: captionId(),
        startMs,
        durationMs: endMs - startMs,
        text: shown.map((entry) => entry.word.text).join(" ").slice(0, 400),
        words: shown.map((entry) => entry.word),
        emphasis: cue.emphasis.flatMap((wordIndex) => {
          const at = shown.findIndex((entry) => entry.wordIndex === wordIndex);
          return at >= 0 ? [at] : [];
        }),
      },
    });
    previousEnd = endMs;
    added += 1;
  }
  return { ops, cues: added, words: words.length };
}
