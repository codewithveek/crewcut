import { describe, expect, it } from "vitest";

import { MIN_HISTORY, type PastVideo, measured, scoreThumbnail, scoreTitle, titleChecks, titleTraits } from "./packaging";

const past = (title: string, ctr: number, impressions = 5000, thumbnail: PastVideo["thumbnail"] = null): PastVideo => ({ title, ctr, impressions, thumbnail });

describe("titleTraits", () => {
  it("reads the traits a title has", () => {
    const keys = (title: string) => titleTraits(title).map((trait) => trait.key);
    expect(keys("7 mistakes you make with light?")).toEqual(expect.arrayContaining(["number", "question", "you", "strong-word", "short"]));
    expect(keys("How I edit a whole video in one hour (no plugins)")).toEqual(expect.arrayContaining(["how-why", "first-person", "brackets"]));
    expect(keys("The NASA photo nobody noticed")).not.toContain("caps");
    expect(keys("This is HUGE")).toContain("caps");
  });
});

describe("scoreTitle", () => {
  it("says there isn't enough history instead of guessing", () => {
    const score = scoreTitle("Anything", [past("a", 0.05), past("b", 0.06)]);
    expect(score.predictedCtr).toBeNull();
    expect(score.confidence).toBe("none");
    expect(score.reasons[0]).toContain(`2 of ${MIN_HISTORY}`);
  });

  it("ignores videos with too few impressions or impossible rates", () => {
    expect(measured([past("a", 0.05, 50), past("b", 0, 9000), past("c", 1.2, 9000), past("d", 0.04)])).toHaveLength(1);
  });

  it("predicts higher for traits that worked on this channel, with reasons", () => {
    const history = [
      past("5 ways to light a room", 0.09),
      past("3 lenses worth buying", 0.08),
      past("10 settings I always change", 0.085),
      past("A quiet morning shoot", 0.04),
      past("Editing with natural light", 0.035),
      past("My camera bag tour", 0.04),
    ];
    const withNumber = scoreTitle("7 colour tricks for night shots", history);
    const without = scoreTitle("Colour tricks for night shots", history);
    expect(withNumber.predictedCtr!).toBeGreaterThan(without.predictedCtr!);
    expect(withNumber.vsTypical!).toBeGreaterThan(1);
    expect(withNumber.reasons.join(" ")).toMatch(/number.*the clicks of the rest \(3 videos\)/);
    expect(withNumber.confidence).toBe("low");
    expect(withNumber.basedOn).toBe(6);
  });

  it("keeps predictions within bounds however extreme the history", () => {
    const history = [past("1", 0.5), past("2", 0.5), past("3", 0.5), past("a", 0.001), past("b", 0.001), past("c", 0.001)];
    const score = scoreTitle("4", history);
    expect(score.vsTypical!).toBeLessThanOrEqual(2.5);
  });
});

describe("scoreThumbnail", () => {
  it("only learns from videos published with a known thumbnail", () => {
    const thumbs = (style: string, ctr: number) => past("x", ctr, 5000, { style, position: "bottom", words: 3, logo: true });
    const history = [thumbs("boxed", 0.1), thumbs("boxed", 0.11), thumbs("bold", 0.05), thumbs("bold", 0.05), thumbs("bold", 0.06), past("no thumb", 0.2)];
    const boxed = scoreThumbnail({ style: "boxed", position: "bottom", words: 3, logo: true }, history);
    const bold = scoreThumbnail({ style: "bold", position: "bottom", words: 3, logo: true }, history);
    expect(boxed.basedOn).toBe(5);
    expect(boxed.predictedCtr!).toBeGreaterThan(bold.predictedCtr!);
    expect(scoreThumbnail({ style: "bold", position: "top", words: 1, logo: false }, history.slice(0, 3)).reasons[0]).toContain("lab thumbnail");
  });
});

describe("titleChecks", () => {
  it("flags long, shouting and spammy titles", () => {
    expect(titleChecks("A fine title").every((check) => check.ok)).toBe(true);
    expect(titleChecks("x".repeat(70)).some((check) => !check.ok)).toBe(true);
    expect(titleChecks("THIS CHANGES EVERYTHING").some((check) => !check.ok)).toBe(true);
    expect(titleChecks("Wow!!!! look").some((check) => !check.ok)).toBe(true);
  });
});
