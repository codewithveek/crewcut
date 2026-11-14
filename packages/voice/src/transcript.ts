import type { WordTiming } from "./timing";

/**
 * Speech-to-text results and where their words land on a timeline. Word
 * times from a transcript are in the SOURCE file's time; a clip plays part of
 * that file (trim), at some speed, from some point on the timeline, maybe
 * looping. `placeWords` turns source times into composition times and keeps
 * only the words the clip actually plays.
 */

/** ElevenLabs speech-to-text (Scribe) → spoken words in source milliseconds. */
export function wordsFromScribe(response: unknown): { words: WordTiming[]; language: string | null } {
  const body = (response && typeof response === "object" ? response : {}) as { words?: unknown; language_code?: unknown };
  const list = Array.isArray(body.words) ? body.words : [];
  const words: WordTiming[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const word = item as { text?: unknown; type?: unknown; start?: unknown; end?: unknown };
    if (word.type !== undefined && word.type !== "word") continue;
    const text = typeof word.text === "string" ? word.text.replace(/\s+/g, " ").trim() : "";
    const start = typeof word.start === "number" ? word.start : Number.NaN;
    const end = typeof word.end === "number" ? word.end : Number.NaN;
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0) continue;
    words.push({ text: text.slice(0, 80), startMs: Math.round(start * 1000), endMs: Math.round(Math.max(end, start) * 1000) });
  }
  words.sort((a, b) => a.startMs - b.startMs);
  return { words, language: typeof body.language_code === "string" ? body.language_code : null };
}

export interface WordPlacement {
  /** Source time the clip starts playing from (its trim). */
  trimStartMs: number;
  /** 2 = twice as fast: one timeline second covers two source seconds. */
  playbackRate: number;
  /** Timeline time at which the source is at `trimStartMs` (may be before the window, for layers already running). */
  timelineStartMs: number;
  /** The part of the timeline the clip is seen and heard in. */
  windowStartMs: number;
  windowEndMs: number;
  /** When the clip loops: the source's full length, so later passes repeat its words. */
  loopSourceMs?: number | null;
}

/** Words the clip plays, in composition time, clipped to its window. */
export function placeWords(words: readonly WordTiming[], placement: WordPlacement): WordTiming[] {
  const rate = placement.playbackRate > 0 ? placement.playbackRate : 1;
  const { trimStartMs, timelineStartMs, windowStartMs, windowEndMs } = placement;
  if (!(windowEndMs > windowStartMs)) return [];
  const toTimeline = (sourceMs: number, pass: number, passMs: number) => timelineStartMs + pass * passMs + (sourceMs - trimStartMs) / rate;
  // A loop plays trimStart → end of the source, again and again.
  const loopMs = placement.loopSourceMs && placement.loopSourceMs > trimStartMs ? (placement.loopSourceMs - trimStartMs) / rate : 0;
  const firstPass = loopMs > 0 ? Math.max(0, Math.floor((windowStartMs - timelineStartMs) / loopMs)) : 0;
  const lastPass = loopMs > 0 ? Math.max(0, Math.ceil((windowEndMs - timelineStartMs) / loopMs)) : 0;
  const placed: WordTiming[] = [];
  for (let pass = firstPass; pass <= lastPass && pass - firstPass < 1000; pass += 1) {
    for (const word of words) {
      if (word.startMs < trimStartMs) continue;
      if (loopMs > 0 && placement.loopSourceMs && word.startMs >= placement.loopSourceMs) continue;
      const startMs = toTimeline(word.startMs, pass, loopMs);
      if (startMs < windowStartMs || startMs >= windowEndMs) continue;
      const endMs = Math.min(windowEndMs, Math.max(startMs + 1, toTimeline(word.endMs, pass, loopMs)));
      placed.push({ text: word.text, startMs: Math.round(startMs), endMs: Math.round(endMs) });
    }
  }
  return placed.sort((a, b) => a.startMs - b.startMs);
}
