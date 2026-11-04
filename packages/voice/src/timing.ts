/**
 * Word timing and captions, ported from vid-skills (`transcript.ts`,
 * `captions.ts`) and moved to milliseconds.
 */
export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}

export const DEFAULT_WPM = 160;

export function syllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!clean) return /\d/.test(word) ? Math.max(1, word.replace(/\D/g, "").length) : 1;
  const groups = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/** Estimated spoken duration for a line at `wpm`, with a floor for very short lines. */
export function estimateSpeechMs(text: string, wpm = DEFAULT_WPM): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const syllableCount = words.reduce((sum, word) => sum + syllables(word), 0);
  // ~1.45 syllables per word in English narration.
  const byWords = (words.length / wpm) * 60_000;
  const bySyllables = (syllableCount / (wpm * 1.45)) * 60_000;
  const pauses = (text.match(/[,;:–—]/g)?.length ?? 0) * 120 + (text.match(/[.!?]/g)?.length ?? 0) * 220;
  return Math.max(500, Math.round((byWords + bySyllables) / 2 + pauses));
}

/**
 * Spreads words over a known duration, weighting by syllables and adding
 * weight after punctuation (vid-skills' estimateWordTimings, ±120 ms).
 */
export function estimateWordTimings(text: string, durationMs: number, offsetMs = 0, leadInMs = 50, tailOutMs = 100): WordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const weights = words.map((word) => syllables(word) + 0.35 + (/[.!?]$/.test(word) ? 1.8 : /[,;:–—]$/.test(word) ? 1 : 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const available = Math.max(1, durationMs - leadInMs - tailOutMs);
  let cursor = offsetMs + leadInMs;
  return words.map((word, index) => {
    const slot = (available * (weights[index] ?? 1)) / total;
    const pause = /[.!?]$/.test(word) ? Math.min(350, slot * 0.4) : /[,;:–—]$/.test(word) ? Math.min(180, slot * 0.3) : 0;
    const timing = { text: word, startMs: Math.round(cursor), endMs: Math.round(cursor + slot - pause) };
    cursor += slot;
    return timing;
  });
}

/** Converts ElevenLabs character alignment to words. */
export function charsToWords(characters: readonly string[], startsSec: readonly number[], endsSec: readonly number[], offsetMs = 0): WordTiming[] {
  const words: WordTiming[] = [];
  let current = "";
  let start = 0;
  let end = 0;
  characters.forEach((character, index) => {
    if (/\s/.test(character)) {
      if (current) words.push({ text: current, startMs: Math.round(start * 1000 + offsetMs), endMs: Math.round(end * 1000 + offsetMs) });
      current = "";
      return;
    }
    if (!current) start = startsSec[index] ?? end;
    current += character;
    end = endsSec[index] ?? start;
  });
  if (current) words.push({ text: current, startMs: Math.round(start * 1000 + offsetMs), endMs: Math.round(end * 1000 + offsetMs) });
  return words;
}

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
  words: WordTiming[];
  emphasis: number[];
}

export interface CaptionOptions {
  maxWords: number;
  maxChars: number;
  maxCueMs: number;
}

export const SHORT_FORM_CAPTIONS: CaptionOptions = { maxWords: 4, maxChars: 24, maxCueMs: 1600 };
export const LONG_FORM_CAPTIONS: CaptionOptions = { maxWords: 9, maxChars: 42, maxCueMs: 3200 };

const normWord = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Groups word timings into readable cues: break on punctuation, pauses and size limits. */
export function buildCaptionCues(words: readonly WordTiming[], options: CaptionOptions, emphasisWords: readonly string[] = []): CaptionCue[] {
  const emphasis = new Set(emphasisWords.map(normWord).filter(Boolean));
  const cues: CaptionCue[] = [];
  let current: WordTiming[] = [];
  const flush = () => {
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) return;
    cues.push({
      startMs: first.startMs,
      endMs: last.endMs,
      text: current.map((word) => word.text).join(" "),
      words: current,
      emphasis: current.flatMap((word, index) => (emphasis.has(normWord(word.text)) ? [index] : [])),
    });
    current = [];
  };
  for (const word of words) {
    const previous = current[current.length - 1];
    const first = current[0];
    const chars = current.reduce((sum, item) => sum + item.text.length + 1, 0) + word.text.length;
    const gap = previous ? word.startMs - previous.endMs : 0;
    if (first && (current.length >= options.maxWords || chars > options.maxChars || word.endMs - first.startMs > options.maxCueMs || gap > 350)) flush();
    current.push(word);
    if (/[.!?;:]$/.test(word.text) || (/[,–—]$/.test(word.text) && current.length >= 2)) flush();
  }
  flush();
  // Extend each cue towards the next (max +400 ms) so captions don't flicker.
  cues.forEach((cue, index) => {
    const next = cues[index + 1];
    cue.endMs = next ? Math.min(next.startMs, cue.endMs + 400) : cue.endMs + 400;
  });
  return cues;
}

function formatClock(ms: number, separator: "," | "."): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

export function toSrt(cues: readonly CaptionCue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${formatClock(cue.startMs, ",")} --> ${formatClock(cue.endMs, ",")}\n${cue.text}\n`).join("\n");
}

export function toVtt(cues: readonly CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map((cue) => `${formatClock(cue.startMs, ".")} --> ${formatClock(cue.endMs, ".")}\n${cue.text}\n`).join("\n")}`;
}

// ── Numbers for TTS ─────────────────────────────────────────────────────────

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

export function cardinal(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value < 0) return `minus ${cardinal(-value)}`;
  if (!Number.isInteger(value)) {
    const [whole, fraction] = String(value).split(".");
    return `${cardinal(Number(whole))} point ${(fraction ?? "").split("").map((digit) => ONES[Number(digit)]).join(" ")}`;
  }
  if (value < 20) return ONES[value] ?? String(value);
  if (value < 100) return `${TENS[Math.floor(value / 10)]}${value % 10 ? `-${ONES[value % 10]}` : ""}`;
  if (value < 1000) return `${ONES[Math.floor(value / 100)]} hundred${value % 100 ? ` ${cardinal(value % 100)}` : ""}`;
  for (const [size, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]] as const) {
    if (value >= size) return `${cardinal(Math.floor(value / size))} ${name}${value % size ? ` ${cardinal(value % size)}` : ""}`;
  }
  return String(value);
}

export function yearWords(year: number): string {
  if (year >= 2000 && year < 2010) return `two thousand${year % 100 ? ` ${cardinal(year % 100)}` : ""}`;
  const high = Math.floor(year / 100);
  const low = year % 100;
  return `${cardinal(high)} ${low === 0 ? "hundred" : low < 10 ? `oh ${cardinal(low)}` : cardinal(low)}`;
}

/** Spells numbers out so TTS reads "1868" as a year and "42%" as "forty-two percent". */
export function toSpeech(text: string): string {
  return text
    .replace(/\b(in|since|by|from|until|back in|of)\s+(1[1-9]\d\d|20\d\d)\b/gi, (_, cue: string, year: string) => `${cue} ${yearWords(Number(year))}`)
    .replace(/\$(\d+(?:\.\d+)?)\s*(k|m|bn|b)?\b/gi, (_, amount: string, scale?: string) => {
      const words = cardinal(Number(amount));
      const unit = scale ? { k: " thousand", m: " million", b: " billion", bn: " billion" }[scale.toLowerCase()] ?? "" : "";
      return `${words}${unit} dollars`;
    })
    .replace(/(\d+(?:\.\d+)?)\s*%/g, (_, amount: string) => `${cardinal(Number(amount))} percent`)
    .replace(/(\d+(?:\.\d+)?)\s*[x×]\b/g, (_, amount: string) => `${cardinal(Number(amount))} times`)
    .replace(/\b\d{1,3}(?:,\d{3})+\b/g, (match) => cardinal(Number(match.replace(/,/g, ""))));
}
