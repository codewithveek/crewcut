import { type WordTiming, charsToWords, estimateSpeechMs, estimateWordTimings, toSpeech } from "./timing";
import { encodeWav, peaksFromPcm } from "./wav";

export interface SynthesisRequest {
  text: string;
  voiceId?: string;
  speed?: number;
  /** Previous/next text improve prosody when stitching lines. */
  previousText?: string;
  nextText?: string;
  signal?: AbortSignal;
}

export interface SynthesisResult {
  bytes: Uint8Array;
  mime: "audio/wav" | "audio/mpeg";
  durationMs: number;
  words: WordTiming[];
  alignment: "provider" | "estimated";
  peaks: number[];
  provider: string;
  /** For the Proof report and the licence check. */
  licence: { name: string; aiGenerated: boolean; commercialUse: boolean };
}

export interface VoiceProvider {
  readonly id: string;
  readonly isAiVoice: boolean;
  /** Does it cost money per character? Counts against the workspace budget. */
  readonly paid: boolean;
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
}

/**
 * Silent narration with estimated timing: used in CI, in previews before a
 * voice is chosen, and when no voice provider is connected. Timing still
 * drives the edit, so swapping in a real voice later just re-syncs.
 */
export class SilentVoiceProvider implements VoiceProvider {
  readonly id = "silent";
  readonly isAiVoice = false;
  readonly paid = false;
  constructor(private readonly wordsPerMinute = 160) {}

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const durationMs = Math.round(estimateSpeechMs(request.text, this.wordsPerMinute) / (request.speed ?? 1));
    const sampleRate = 8000;
    const samples = new Float32Array(Math.ceil((durationMs / 1000) * sampleRate));
    return {
      bytes: encodeWav({ sampleRate, channels: [samples] }),
      mime: "audio/wav",
      durationMs,
      words: estimateWordTimings(request.text, durationMs),
      alignment: "estimated",
      peaks: estimatedPeaks(request.text, 80),
      provider: this.id,
      licence: { name: "none (silent placeholder)", aiGenerated: false, commercialUse: true },
    };
  }
}

/** A word-length envelope so the timeline shows speech shape before real audio exists. */
export function estimatedPeaks(text: string, buckets: number): number[] {
  const words = text.split(/\s+/).filter(Boolean);
  const peaks: number[] = [];
  for (let index = 0; index < buckets; index += 1) {
    const word = words[Math.floor((index / buckets) * words.length)] ?? "";
    const wobble = 0.55 + 0.35 * Math.abs(Math.sin(index * 1.7 + word.length));
    peaks.push(Math.round(Math.min(1, wobble * (word.length > 0 ? 1 : 0.1)) * 1000) / 1000);
  }
  return peaks;
}

interface ElevenLabsTimestampsResponse {
  audio_base64: string;
  alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } | null;
}

export interface ElevenLabsOptions {
  apiKey: string;
  defaultVoiceId: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
}

/**
 * ElevenLabs with character timestamps → word timings (vid-skills' TTS),
 * requesting raw PCM so durations are exact without decoding MP3 (Cutroom).
 */
export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly id = "elevenlabs";
  readonly isAiVoice = true;
  readonly paid = true;
  constructor(private readonly options: ElevenLabsOptions) {}

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const voiceId = request.voiceId ?? this.options.defaultVoiceId;
    const sampleRate = 24_000;
    const response = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=pcm_24000`,
      {
        method: "POST",
        headers: { "xi-api-key": this.options.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          text: toSpeech(request.text),
          model_id: this.options.modelId ?? "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, request.speed ?? 1)) },
          ...(request.previousText ? { previous_text: request.previousText } : {}),
          ...(request.nextText ? { next_text: request.nextText } : {}),
        }),
        ...(request.signal ? { signal: request.signal } : {}),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`ElevenLabs ${response.status}: ${detail}`);
    }
    const body = (await response.json()) as ElevenLabsTimestampsResponse;
    const pcmBytes = Uint8Array.from(atob(body.audio_base64), (character) => character.charCodeAt(0));
    const samples = new Float32Array(pcmBytes.length / 2);
    const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
    for (let index = 0; index < samples.length; index += 1) samples[index] = view.getInt16(index * 2, true) / 32768;
    const durationMs = Math.round((samples.length / sampleRate) * 1000);
    const alignment = body.alignment;
    const spokenWords = alignment
      ? charsToWords(alignment.characters, alignment.character_start_times_seconds, alignment.character_end_times_seconds)
      : [];
    // Keep display words ("1868") while using spoken timing ("eighteen sixty-eight").
    const words = remapToDisplay(request.text, spokenWords, durationMs);
    return {
      bytes: encodeWav({ sampleRate, channels: [samples] }),
      mime: "audio/wav",
      durationMs,
      words,
      alignment: alignment ? "provider" : "estimated",
      peaks: peaksFromPcm(samples, 160),
      provider: this.id,
      licence: { name: "ElevenLabs (commercial plans)", aiGenerated: true, commercialUse: true },
    };
  }
}

/** Folds spoken-word timings back onto the display words, proportionally. */
export function remapToDisplay(displayText: string, spoken: readonly WordTiming[], durationMs: number): WordTiming[] {
  const display = displayText.trim().split(/\s+/).filter(Boolean);
  if (spoken.length === 0) return estimateWordTimings(displayText, durationMs);
  if (spoken.length === display.length) return spoken.map((word, index) => ({ ...word, text: display[index] ?? word.text }));
  const first = spoken[0];
  const last = spoken[spoken.length - 1];
  const start = first?.startMs ?? 0;
  const end = last?.endMs ?? durationMs;
  return estimateWordTimings(displayText, end - start + 150, start - 50);
}

export function createVoiceProvider(options: { elevenLabsApiKey?: string | undefined; elevenLabsVoiceId?: string | undefined }): VoiceProvider {
  if (options.elevenLabsApiKey && options.elevenLabsVoiceId) {
    return new ElevenLabsVoiceProvider({ apiKey: options.elevenLabsApiKey, defaultVoiceId: options.elevenLabsVoiceId });
  }
  return new SilentVoiceProvider();
}
