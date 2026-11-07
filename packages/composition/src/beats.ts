import type { CompositionOpInput } from "./composition-ops";
import { clipEndMs } from "./query";
import type { Composition } from "./schema";

/**
 * Beat sync: find where a track's beats fall and move the cuts onto them.
 * Everything works on an amplitude envelope (peaks per second, 0..1) so it
 * runs anywhere: the editor decodes the audio once and passes its envelope in.
 */

/** Rises in loudness (where notes and drums start): the envelope's positive steps. */
export function onsetEnvelope(peaks: ArrayLike<number>): Float32Array {
  const out = new Float32Array(peaks.length);
  for (let index = 1; index < peaks.length; index += 1) out[index] = Math.max(0, (peaks[index] ?? 0) - (peaks[index - 1] ?? 0));
  return out;
}

function sampleAt(values: Float32Array, position: number): number {
  const index = Math.round(position);
  if (index < 0 || index >= values.length) return 0;
  // Allow a frame either side: the envelope is coarse (20 ms buckets at 50/s).
  return Math.max(values[index] ?? 0, 0.5 * (values[index - 1] ?? 0), 0.5 * (values[index + 1] ?? 0));
}

/**
 * Where the beat grid starts (ms into the audio, 0 ≤ offset < one beat) for a
 * known tempo: the offset whose beats line up with the most onset energy.
 */
export function beatPhaseMs(onsets: Float32Array, ratePerSecond: number, bpm: number): number {
  const periodMs = 60_000 / bpm;
  const durationMs = (onsets.length / ratePerSecond) * 1000;
  let best = 0;
  let bestScore = -1;
  for (let offset = 0; offset < periodMs; offset += 5) {
    let score = 0;
    for (let at = offset; at < durationMs; at += periodMs) score += sampleAt(onsets, (at / 1000) * ratePerSecond);
    if (score > bestScore) {
      bestScore = score;
      best = offset;
    }
  }
  return best;
}

/** Below this confidence there's no steady beat to snap to (noise scores about 0.1, steady music 0.4+). */
export const STEADY_BEAT = 0.3;

/**
 * The tempo of music with a steady beat (70–180 BPM), from the autocorrelation
 * of its onsets. confidence is the share of the onsets' variation that
 * repeats every beat (see STEADY_BEAT).
 */
export function estimateTempo(onsets: Float32Array, ratePerSecond: number): { bpm: number; confidence: number } | null {
  const minLag = Math.floor((60 / 180) * ratePerSecond);
  const maxLag = Math.ceil((60 / 70) * ratePerSecond);
  if (onsets.length < maxLag * 4) return null;
  const mean = onsets.reduce((sum, value) => sum + value, 0) / onsets.length;
  const centered = Array.from(onsets, (value) => value - mean);
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let index = lag; index < centered.length; index += 1) sum += (centered[index] ?? 0) * (centered[index - lag] ?? 0);
    scores.push(sum / (centered.length - lag));
  }
  // Music often repeats at related tempos too (a triplet feel scores at 5/3 of
  // the beat). Weigh choices toward common tempos (around 120 BPM) so the
  // felt beat wins over its echoes; confidence still uses the raw score.
  const prior = (index: number) => Math.exp(-0.5 * (Math.log2(60 / ((minLag + index) / ratePerSecond) / 120) / 0.6) ** 2);
  let bestIndex = 0;
  for (let index = 1; index < scores.length; index += 1) if ((scores[index] ?? 0) * prior(index) > (scores[bestIndex] ?? 0) * prior(bestIndex)) bestIndex = index;
  // A beat repeats every two beats too: when a slow reading (< 90 BPM) has a
  // nearly as strong repeat at half the period, the real tempo is the faster one.
  const halfIndex = Math.round((minLag + bestIndex) / 2) - minLag;
  if (60 / ((minLag + bestIndex) / ratePerSecond) < 90 && halfIndex >= 0 && (scores[halfIndex] ?? 0) >= 0.8 * (scores[bestIndex] ?? 0)) bestIndex = halfIndex;
  const peak = scores[bestIndex] ?? 0;
  if (peak <= 0) return null;
  // Parabolic refinement between whole-frame lags.
  const left = scores[bestIndex - 1] ?? peak;
  const right = scores[bestIndex + 1] ?? peak;
  const denominator = left - 2 * peak + right;
  const shift = denominator !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denominator)) : 0;
  const lagSeconds = (minLag + bestIndex + shift) / ratePerSecond;
  // How much of the onsets' variation repeats every beat: about 0 for noise, 0.3+ for a steady beat.
  const variance = centered.reduce((sum, value) => sum + value * value, 0) / centered.length;
  return { bpm: Math.round((60 / lagSeconds) * 10) / 10, confidence: peak / Math.max(variance, 1e-9) };
}

/** Beat times on the timeline (ms) for music placed at clipStartMs, trimmed by trimStartMs and played at playbackRate. */
export function timelineBeats(input: { bpm: number; phaseMs: number; clipStartMs: number; clipDurationMs: number; trimStartMs: number; playbackRate: number }): number[] {
  const periodMs = 60_000 / input.bpm;
  const beats: number[] = [];
  const firstSource = input.trimStartMs + ((((input.phaseMs - input.trimStartMs) % periodMs) + periodMs) % periodMs);
  for (let source = firstSource; ; source += periodMs) {
    const at = input.clipStartMs + (source - input.trimStartMs) / input.playbackRate;
    if (at > input.clipStartMs + input.clipDurationMs + 0.5) break;
    beats.push(Math.round(at));
  }
  return beats;
}

/**
 * Ops that move every cut on a visual track (within fromMs..toMs) onto the
 * nearest beat. Each cut is a rippling trim of the clip before it, so the
 * clips after it move with it and keep their lengths. Clips stay at least
 * minClipMs long, and clips with video only get shorter (they can't run past
 * their footage). Returns the ops and how many cuts moved.
 */
export function snapCutsToBeats(composition: Composition, input: { trackId: string; beats: readonly number[]; fromMs?: number; toMs?: number; minClipMs?: number; toleranceMs?: number }): { ops: CompositionOpInput[]; moved: number } {
  const track = composition.tracks.find((candidate) => candidate.id === input.trackId);
  if (!track || track.kind !== "visual" || track.locked || input.beats.length === 0) return { ops: [], moved: 0 };
  const minClip = input.minClipMs ?? 400;
  const tolerance = input.toleranceMs ?? 15;
  const fromMs = input.fromMs ?? 0;
  const toMs = input.toMs ?? Number.POSITIVE_INFINITY;
  const beats = [...input.beats].sort((a, b) => a - b);
  const clips = [...track.clips].sort((a, b) => a.startMs - b.startMs).map((clip) => ({ id: clip.id, start: clip.startMs, end: clipEndMs(clip), video: clip.layers.some((layer) => layer.type === "video") }));
  const ops: CompositionOpInput[] = [];
  for (let index = 0; index < clips.length - 1; index += 1) {
    const clip = clips[index]!;
    const next = clips[index + 1]!;
    // Only real cuts (the next clip starts where this one ends) inside the music.
    if (Math.abs(next.start - clip.end) > 50 || clip.end < fromMs || clip.end > toMs) continue;
    const allowed = beats.filter((beat) => beat - clip.start >= minClip && (!clip.video || beat <= clip.end + 0.5));
    if (allowed.length === 0) continue;
    const target = allowed.reduce((best, beat) => (Math.abs(beat - clip.end) < Math.abs(best - clip.end) ? beat : best));
    const delta = target - clip.end;
    if (Math.abs(delta) <= tolerance) continue;
    ops.push({ op: "trim-clip", clipId: clip.id, edge: "end", toMs: target, ripple: true });
    const oldEnd = clip.end;
    clip.end = target;
    for (const other of clips) if (other !== clip && other.start >= oldEnd - 0.5) (other.start += delta), (other.end += delta);
  }
  return { ops, moved: ops.length };
}
