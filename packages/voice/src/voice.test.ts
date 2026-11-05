import { describe, expect, it } from "vitest";

import { SilentVoiceProvider, remapToDisplay } from "./providers";
import {
  SHORT_FORM_CAPTIONS,
  buildCaptionCues,
  cardinal,
  charsToWords,
  estimateSpeechMs,
  estimateWordTimings,
  toSpeech,
  toSrt,
  toVtt,
  yearWords,
} from "./timing";
import { decodeWav, durationMsOf, encodeWav, peaksFromPcm } from "./wav";

describe("speech timing", () => {
  it("estimates around 160 wpm", () => {
    const text = "This sentence has exactly ten words in it for timing.";
    const ms = estimateSpeechMs(text);
    expect(ms).toBeGreaterThan(2500);
    expect(ms).toBeLessThan(6000);
  });

  it("spreads word timings inside the duration, in order", () => {
    const words = estimateWordTimings("Hello there, this is Crewcut.", 2000, 1000);
    expect(words).toHaveLength(5);
    expect(words[0]?.startMs).toBeGreaterThanOrEqual(1000);
    expect(words.at(-1)?.endMs).toBeLessThanOrEqual(3000);
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index]!.startMs).toBeGreaterThanOrEqual(words[index - 1]!.endMs);
    }
  });

  it("converts character alignment to words", () => {
    const characters = [..."hi you"];
    const starts = characters.map((_, index) => index * 0.1);
    const ends = characters.map((_, index) => index * 0.1 + 0.08);
    expect(charsToWords(characters, starts, ends)).toEqual([
      { text: "hi", startMs: 0, endMs: 180 },
      { text: "you", startMs: 300, endMs: 580 },
    ]);
  });

  it("keeps display words when spoken timings line up", () => {
    const spoken = [{ text: "eighteen", startMs: 0, endMs: 400 }];
    expect(remapToDisplay("1868", spoken, 500)[0]?.text).toBe("1868");
  });
});

describe("numbers for TTS", () => {
  it("spells years, percents, money and multipliers", () => {
    expect(yearWords(1868)).toBe("eighteen sixty-eight");
    expect(yearWords(1905)).toBe("nineteen oh five");
    expect(yearWords(2004)).toBe("two thousand four");
    expect(cardinal(1200)).toBe("one thousand two hundred");
    expect(toSpeech("Back in 1868, 42% paid $3m for a 10x win")).toBe(
      "Back in eighteen sixty-eight, forty-two percent paid three million dollars for a ten times win",
    );
  });
});

describe("captions", () => {
  const words = estimateWordTimings("Every claim links to its source. Every decision is logged, forever.", 4000);
  const cues = buildCaptionCues(words, SHORT_FORM_CAPTIONS, ["source"]);

  it("chunks into short cues that break on punctuation", () => {
    expect(cues.length).toBeGreaterThanOrEqual(3);
    for (const cue of cues) expect(cue.words.length).toBeLessThanOrEqual(4);
    expect(cues.some((cue) => cue.text.endsWith("source."))).toBe(true);
    expect(cues.find((cue) => cue.text.includes("source"))?.emphasis.length).toBe(1);
  });

  it("exports SRT and VTT", () => {
    expect(toSrt(cues)).toMatch(/^1\n00:00:00,\d{3} --> /);
    expect(toVtt(cues)).toMatch(/^WEBVTT\n\n00:00:00\.\d{3} --> /);
  });
});

describe("wav and providers", () => {
  it("round-trips PCM", () => {
    const samples = new Float32Array(8000).map((_, index) => Math.sin(index / 10) * 0.5);
    const decoded = decodeWav(encodeWav({ sampleRate: 8000, channels: [samples] }));
    expect(durationMsOf(decoded)).toBe(1000);
    expect(decoded.channels[0]?.[100]).toBeCloseTo(samples[100] ?? 0, 3);
    expect(Math.max(...peaksFromPcm(samples, 10))).toBe(1);
  });

  it("silent provider returns estimated timing and a playable wav", async () => {
    const result = await new SilentVoiceProvider().synthesize({ text: "Proof over claims." });
    expect(result.alignment).toBe("estimated");
    expect(result.words).toHaveLength(3);
    expect(durationMsOf(decodeWav(result.bytes))).toBeCloseTo(result.durationMs, -2);
  });
});
