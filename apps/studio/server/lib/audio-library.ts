import { stat } from "node:fs/promises";

import { encodeWav } from "@crewcut/voice";

import { promoteToRemote } from "./blob-store.js";
import { storagePath, writeStorageFile } from "./storage.js";

/**
 * Crewcut's built-in audio library: music beds and sound effects
 * synthesised deterministically on the server (no samples, no licences to
 * track). Files are generated once into storage/assets as lib-<id>.wav and
 * shared by every asset row that references them.
 */

const SR = 32_000;

export interface LibraryItem {
  id: string;
  label: string;
  kind: "music" | "sfx";
  mood: string;
  bpm?: number;
  durationMs: number;
  generate: () => Float32Array;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);
const buffer = (seconds: number) => new Float32Array(Math.round(seconds * SR));

function normalize(samples: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (const value of samples) max = Math.max(max, Math.abs(value));
  if (max > 0) for (let i = 0; i < samples.length; i += 1) samples[i] = ((samples[i] ?? 0) / max) * peak;
  return samples;
}

/** Short fade at both ends so loops and cuts never click. */
function declick(samples: Float32Array, ms = 12): Float32Array {
  const n = Math.min(samples.length / 2, Math.round((ms / 1000) * SR));
  for (let i = 0; i < n; i += 1) {
    const g = i / n;
    samples[i] = (samples[i] ?? 0) * g;
    samples[samples.length - 1 - i] = (samples[samples.length - 1 - i] ?? 0) * g;
  }
  return samples;
}

function lowpass(samples: Float32Array, cutoff: (index: number) => number): Float32Array {
  let y = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = 1 - Math.exp((-2 * Math.PI * Math.max(20, cutoff(i))) / SR);
    y += a * ((samples[i] ?? 0) - y);
    samples[i] = y;
  }
  return samples;
}

function highpass(samples: Float32Array, cutoff: number): Float32Array {
  const low = lowpass(Float32Array.from(samples), () => cutoff);
  for (let i = 0; i < samples.length; i += 1) samples[i] = (samples[i] ?? 0) - (low[i] ?? 0);
  return samples;
}

function noise(length: number, seed: number): Float32Array {
  const random = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = random() * 2 - 1;
  return out;
}

/** Adds a tone at `startS` with an ADSR-ish envelope; `shape` picks the waveform. */
function addTone(
  out: Float32Array,
  options: { freq: number | ((t: number) => number); startS: number; durS: number; gain: number; attackS?: number; releaseS?: number; decay?: number; shape?: "sine" | "triangle" | "soft-saw" | "epiano" | "bell" },
): void {
  const { startS, durS, gain } = options;
  const attack = options.attackS ?? 0.005;
  const release = options.releaseS ?? 0.05;
  const start = Math.round(startS * SR);
  const length = Math.round((durS + release) * SR);
  let phase = 0;
  for (let i = 0; i < length && start + i < out.length; i += 1) {
    const t = i / SR;
    const freq = typeof options.freq === "function" ? options.freq(t) : options.freq;
    phase += (2 * Math.PI * freq) / SR;
    let env = t < attack ? t / attack : t > durS ? Math.max(0, 1 - (t - durS) / release) : 1;
    if (options.decay) env *= Math.exp(-t * options.decay);
    let wave: number;
    switch (options.shape ?? "sine") {
      case "triangle":
        wave = (2 / Math.PI) * Math.asin(Math.sin(phase));
        break;
      case "soft-saw":
        wave = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase) + 0.12 * Math.sin(4 * phase);
        break;
      case "epiano":
        wave = Math.sin(phase + 0.6 * Math.exp(-t * 6) * Math.sin(phase * 2)) + 0.25 * Math.sin(2 * phase) * Math.exp(-t * 3);
        break;
      case "bell":
        wave = Math.sin(phase) + 0.45 * Math.sin(phase * 2.76) * Math.exp(-t * 3) + 0.25 * Math.sin(phase * 5.4) * Math.exp(-t * 6);
        break;
      default:
        wave = Math.sin(phase);
    }
    out[start + i] = (out[start + i] ?? 0) + wave * env * gain;
  }
}

function addKick(out: Float32Array, startS: number, gain = 0.9): void {
  addTone(out, { freq: (t) => 48 + 90 * Math.exp(-t * 28), startS, durS: 0.32, gain, attackS: 0.001, releaseS: 0.02, decay: 9 });
}

function addHat(out: Float32Array, startS: number, seed: number, gain = 0.18, lengthS = 0.05): void {
  const burst = highpass(noise(Math.round(lengthS * SR), seed), 6500);
  const start = Math.round(startS * SR);
  for (let i = 0; i < burst.length && start + i < out.length; i += 1) out[start + i] = (out[start + i] ?? 0) + (burst[i] ?? 0) * gain * Math.exp((-i / SR) * 60);
}

function addSnare(out: Float32Array, startS: number, seed: number, gain = 0.35): void {
  const burst = lowpass(highpass(noise(Math.round(0.22 * SR), seed), 1200), () => 7000);
  const start = Math.round(startS * SR);
  for (let i = 0; i < burst.length && start + i < out.length; i += 1) out[start + i] = (out[start + i] ?? 0) + (burst[i] ?? 0) * gain * Math.exp((-i / SR) * 18);
  addTone(out, { freq: 190, startS, durS: 0.08, gain: gain * 0.4, decay: 25 });
}

// ── Music ───────────────────────────────────────────────────────────────────

function calmPads(): Float32Array {
  const chords = [
    [48, 55, 59, 64],
    [45, 52, 55, 60],
    [41, 48, 52, 57],
    [43, 50, 55, 59],
  ];
  const bar = 7.5;
  const out = buffer(bar * chords.length);
  chords.forEach((chord, index) => {
    const startS = index * bar;
    for (const note of chord) {
      for (const detune of [-0.004, 0.004]) addTone(out, { freq: midi(note + 12) * (1 + detune), startS, durS: bar - 0.4, gain: 0.08, attackS: 1.6, releaseS: 1.8, shape: "triangle" });
    }
    addTone(out, { freq: midi((chord[0] ?? 48) - 12), startS, durS: bar - 0.2, gain: 0.12, attackS: 0.8, releaseS: 1.2 });
    // Soft high sparkle on the off-beats.
    for (let beat = 1; beat < 8; beat += 2) addTone(out, { freq: midi((chord[3] ?? 64) + 24), startS: startS + beat * (bar / 8), durS: 0.4, gain: 0.025, decay: 4, shape: "bell" });
  });
  for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) * (0.92 + 0.08 * Math.sin((2 * Math.PI * i) / (SR * 3.75)));
  return declick(normalize(out, 0.7), 400);
}

function upbeatPulse(): Float32Array {
  const bpm = 112;
  const beat = 60 / bpm;
  const progression = [57, 53, 48, 55];
  const bars = 16;
  const out = buffer(bars * 4 * beat);
  for (let barIndex = 0; barIndex < bars; barIndex += 1) {
    const root = progression[barIndex % progression.length] ?? 57;
    const barStart = barIndex * 4 * beat;
    for (let b = 0; b < 4; b += 1) {
      addKick(out, barStart + b * beat, 0.85);
      addHat(out, barStart + b * beat + beat / 2, barIndex * 16 + b, 0.16);
      if (b % 2 === 1) addSnare(out, barStart + b * beat, barIndex * 8 + b, 0.28);
    }
    for (let eighth = 0; eighth < 8; eighth += 1) {
      addTone(out, { freq: midi(root - 24 + (eighth % 4 === 3 ? 7 : 0)), startS: barStart + eighth * (beat / 2), durS: beat / 2 - 0.03, gain: 0.16, decay: 5, shape: "soft-saw" });
    }
    const arp = [0, 7, 12, 16, 12, 7, 0, 7];
    arp.forEach((offset, step) => addTone(out, { freq: midi(root + offset + (barIndex % 4 === 3 ? 2 : 0)), startS: barStart + step * (beat / 2), durS: 0.12, gain: 0.07, decay: 10, shape: "triangle" }));
  }
  return declick(normalize(lowpass(out, () => 9000), 0.75), 30);
}

function lofiKeys(): Float32Array {
  const bpm = 84;
  const beat = 60 / bpm;
  const chords = [
    [50, 53, 57, 60],
    [55, 59, 62, 65],
    [48, 52, 55, 59],
    [45, 48, 52, 55],
  ];
  const bars = 10;
  const out = buffer(bars * 4 * beat);
  for (let barIndex = 0; barIndex < bars; barIndex += 1) {
    const chord = chords[barIndex % chords.length] ?? chords[0] ?? [];
    const barStart = barIndex * 4 * beat;
    chord.forEach((note, index) => addTone(out, { freq: midi(note), startS: barStart + index * 0.012, durS: 4 * beat - 0.2, gain: 0.09, decay: 0.9, shape: "epiano" }));
    addTone(out, { freq: midi((chord[0] ?? 50) - 24), startS: barStart, durS: 2 * beat, gain: 0.14, decay: 1.2 });
    addKick(out, barStart, 0.6);
    addKick(out, barStart + 2.5 * beat, 0.45);
    addSnare(out, barStart + beat, barIndex * 4 + 1, 0.2);
    addSnare(out, barStart + 3 * beat, barIndex * 4 + 3, 0.2);
    for (let eighth = 0; eighth < 8; eighth += 1) {
      const swing = eighth % 2 === 1 ? beat * 0.08 : 0;
      addHat(out, barStart + eighth * (beat / 2) + swing, barIndex * 32 + eighth, eighth % 2 ? 0.07 : 0.1, 0.035);
    }
  }
  // Vinyl crackle.
  const random = mulberry32(99);
  for (let i = 0; i < out.length; i += 1) if (random() < 0.0009) out[i] = (out[i] ?? 0) + (random() - 0.5) * 0.25;
  return declick(normalize(lowpass(out, () => 5200), 0.7), 60);
}

// ── Sound effects ───────────────────────────────────────────────────────────

function whoosh(lengthS: number, seed: number): () => Float32Array {
  return () => {
    const out = noise(Math.round(lengthS * SR), seed);
    lowpass(out, (i) => 300 + 5200 * Math.sin((Math.PI * i) / out.length) ** 2);
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) * Math.sin((Math.PI * i) / out.length) ** 1.6;
    return declick(normalize(out, 0.85));
  };
}

const SFX: Array<Omit<LibraryItem, "durationMs" | "kind"> & { lengthS: number }> = [
  { id: "sfx-whoosh", label: "Whoosh", mood: "transition", lengthS: 0.75, generate: whoosh(0.75, 11) },
  { id: "sfx-swish", label: "Quick swish", mood: "transition", lengthS: 0.35, generate: whoosh(0.35, 12) },
  {
    id: "sfx-pop",
    label: "Pop",
    mood: "ui",
    lengthS: 0.18,
    generate: () => {
      const out = buffer(0.18);
      addTone(out, { freq: (t) => 220 + 700 * Math.exp(-t * 40), startS: 0, durS: 0.12, gain: 1, attackS: 0.002, decay: 22 });
      return declick(normalize(out, 0.85), 4);
    },
  },
  {
    id: "sfx-click",
    label: "Click",
    mood: "ui",
    lengthS: 0.06,
    generate: () => {
      const out = buffer(0.06);
      addTone(out, { freq: 2400, startS: 0, durS: 0.02, gain: 0.6, attackS: 0.0005, decay: 120 });
      addHat(out, 0, 5, 0.8, 0.03);
      return declick(normalize(out, 0.8), 2);
    },
  },
  {
    id: "sfx-ding",
    label: "Ding",
    mood: "notification",
    lengthS: 1.6,
    generate: () => {
      const out = buffer(1.6);
      addTone(out, { freq: midi(88), startS: 0, durS: 1.4, gain: 0.8, attackS: 0.002, decay: 2.6, shape: "bell" });
      return declick(normalize(out, 0.8));
    },
  },
  {
    id: "sfx-success",
    label: "Success chime",
    mood: "notification",
    lengthS: 1.2,
    generate: () => {
      const out = buffer(1.2);
      addTone(out, { freq: midi(84), startS: 0, durS: 0.9, gain: 0.6, decay: 3.5, shape: "bell" });
      addTone(out, { freq: midi(91), startS: 0.14, durS: 0.9, gain: 0.6, decay: 3, shape: "bell" });
      return declick(normalize(out, 0.8));
    },
  },
  {
    id: "sfx-impact",
    label: "Impact",
    mood: "emphasis",
    lengthS: 1.3,
    generate: () => {
      const out = buffer(1.3);
      addTone(out, { freq: (t) => 38 + 70 * Math.exp(-t * 9), startS: 0, durS: 1.1, gain: 1, attackS: 0.001, decay: 3.2 });
      const hit = lowpass(noise(out.length, 21), (i) => 4000 * Math.exp(-i / (SR * 0.08)) + 200);
      for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + (hit[i] ?? 0) * 0.9 * Math.exp((-i / SR) * 7);
      return declick(normalize(out, 0.9));
    },
  },
  {
    id: "sfx-riser",
    label: "Riser",
    mood: "tension",
    lengthS: 2.6,
    generate: () => {
      const out = noise(Math.round(2.6 * SR), 31);
      lowpass(out, (i) => 200 + 7000 * (i / out.length) ** 2);
      for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) * (i / out.length) ** 1.5 * 0.8;
      addTone(out, { freq: (t) => 180 * 2 ** (t * 1.1), startS: 0, durS: 2.5, gain: 0.25, attackS: 1.2, releaseS: 0.08, shape: "triangle" });
      return declick(normalize(out, 0.85));
    },
  },
  {
    id: "sfx-typing",
    label: "Keyboard typing",
    mood: "ui",
    lengthS: 1.8,
    generate: () => {
      const out = buffer(1.8);
      const random = mulberry32(41);
      let t = 0.02;
      let index = 0;
      while (t < 1.7) {
        addHat(out, t, 100 + index, 0.5 + random() * 0.4, 0.025);
        addTone(out, { freq: 900 + random() * 600, startS: t, durS: 0.01, gain: 0.15, decay: 200 });
        t += 0.06 + random() * 0.11;
        index += 1;
      }
      return declick(normalize(lowpass(out, () => 8000), 0.7));
    },
  },
];

export const AUDIO_LIBRARY: readonly LibraryItem[] = [
  { id: "music-calm-pads", label: "Calm pads", kind: "music", mood: "ambient · reflective", durationMs: 30_000, generate: calmPads },
  { id: "music-upbeat-pulse", label: "Upbeat pulse", kind: "music", mood: "energetic · tech", bpm: 112, durationMs: Math.round(((16 * 4 * 60) / 112) * 1000), generate: upbeatPulse },
  { id: "music-lofi-keys", label: "Lo-fi keys", kind: "music", mood: "chill · warm", bpm: 84, durationMs: Math.round(((10 * 4 * 60) / 84) * 1000), generate: lofiKeys },
  ...SFX.map(({ lengthS, ...item }) => ({ ...item, kind: "sfx" as const, durationMs: Math.round(lengthS * 1000) })),
];

export function libraryFileName(itemId: string): string {
  return `lib-${itemId}.wav`;
}

const pending = new Map<string, Promise<number>>();

/** Generates the item's WAV once; returns its size in bytes. */
export function ensureLibraryFile(item: LibraryItem): Promise<number> {
  let promise = pending.get(item.id);
  if (!promise) {
    promise = (async () => {
      const fileName = libraryFileName(item.id);
      let size: number;
      try {
        size = (await stat(storagePath("assets", fileName))).size;
      } catch {
        const bytes = encodeWav({ sampleRate: SR, channels: [item.generate()] });
        await writeStorageFile("assets", fileName, bytes);
        size = bytes.byteLength;
      }
      await promoteToRemote("assets", fileName, "audio/wav").catch(() => undefined);
      return size;
    })();
    promise.catch(() => pending.delete(item.id));
    pending.set(item.id, promise);
  }
  return promise;
}
