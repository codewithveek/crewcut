import { describe, expect, it } from "vitest";

import { placeWords, wordsFromScribe } from "./transcript";

const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });

describe("wordsFromScribe", () => {
  it("keeps spoken words in milliseconds and drops spacing, sound tags and broken items", () => {
    const result = wordsFromScribe({
      language_code: "en",
      words: [
        { text: "Hello,", type: "word", start: 0.12, end: 0.5 },
        { text: " ", type: "spacing", start: 0.5, end: 0.55 },
        { text: "(laughter)", type: "audio_event", start: 0.6, end: 1.1 },
        { text: "world.", type: "word", start: 1.2, end: 1.61 },
        { text: "", type: "word", start: 2, end: 2.1 },
        { text: "nope", type: "word", start: null, end: 3 },
        "junk",
      ],
    });
    expect(result.language).toBe("en");
    expect(result.words).toEqual([w("Hello,", 120, 500), w("world.", 1200, 1610)]);
  });

  it("copes with an empty or odd response", () => {
    expect(wordsFromScribe(null)).toEqual({ words: [], language: null });
    expect(wordsFromScribe({ words: "x" })).toEqual({ words: [], language: null });
  });
});

describe("placeWords", () => {
  const words = [w("one", 0, 400), w("two", 1000, 1400), w("three", 2000, 2400), w("four", 3000, 3400)];

  it("moves words to where the clip sits on the timeline", () => {
    expect(placeWords(words, { trimStartMs: 0, playbackRate: 1, timelineStartMs: 5000, windowStartMs: 5000, windowEndMs: 9000 })).toEqual([
      w("one", 5000, 5400),
      w("two", 6000, 6400),
      w("three", 7000, 7400),
      w("four", 8000, 8400),
    ]);
  });

  it("drops trimmed-off words and cuts the last one at the clip's end", () => {
    // Trimmed 1 s in, plays 2.2 s: "two" at 0, "three" at 1000, "four" would start at 2000 and end past 2200.
    expect(placeWords(words, { trimStartMs: 1000, playbackRate: 1, timelineStartMs: 0, windowStartMs: 0, windowEndMs: 2200 })).toEqual([w("two", 0, 400), w("three", 1000, 1400), w("four", 2000, 2200)]);
  });

  it("follows the playback speed", () => {
    expect(placeWords(words, { trimStartMs: 0, playbackRate: 2, timelineStartMs: 0, windowStartMs: 0, windowEndMs: 1200 })).toEqual([w("one", 0, 200), w("two", 500, 700), w("three", 1000, 1200)]);
  });

  it("handles a layer that was already running when its clip begins", () => {
    // Source started 1.5 s before the clip's window opened.
    expect(placeWords(words, { trimStartMs: 0, playbackRate: 1, timelineStartMs: 8500, windowStartMs: 10_000, windowEndMs: 20_000 })).toEqual([w("three", 10_500, 10_900), w("four", 11_500, 11_900)]);
  });

  it("repeats words on each pass of a loop", () => {
    const placed = placeWords([w("hi", 100, 300)], { trimStartMs: 0, playbackRate: 1, timelineStartMs: 0, windowStartMs: 0, windowEndMs: 2500, loopSourceMs: 1000 });
    expect(placed).toEqual([w("hi", 100, 300), w("hi", 1100, 1300), w("hi", 2100, 2300)]);
  });

  it("returns nothing for an empty window", () => {
    expect(placeWords(words, { trimStartMs: 0, playbackRate: 1, timelineStartMs: 0, windowStartMs: 100, windowEndMs: 100 })).toEqual([]);
  });
});
