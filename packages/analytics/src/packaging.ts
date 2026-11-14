import { median } from "./trends";

/**
 * Titles and thumbnails scored against the channel's own click-through
 * history. A video's click-through rate (CTR) is clicks ÷ thumbnail
 * impressions. For each trait a title or thumbnail can have ("has a
 * number", "boxed style"…), the channel's past videos with that trait are
 * compared with those without; the traits a candidate has move its predicted
 * CTR up or down from the channel's typical CTR.
 *
 * Small samples are pulled towards "no effect" (shrinkage), every reason says
 * how many videos it rests on, and with fewer than MIN_HISTORY measured
 * videos nothing is predicted at all.
 */

export const MIN_HISTORY = 5;
/** Below this many impressions a video's CTR is noise. */
export const MIN_IMPRESSIONS = 100;

export interface PastVideo {
  title: string;
  ctr: number;
  impressions: number;
  /** Traits of the thumbnail it was published with, when known. */
  thumbnail?: ThumbnailTraits | null;
}

export interface ThumbnailTraits {
  style: string;
  position: string;
  words: number;
  logo: boolean;
}

export interface Trait {
  key: string;
  /** "titles with a number", "the boxed style" */
  label: string;
}

export interface Score {
  /** null until the channel has enough measured videos. */
  predictedCtr: number | null;
  /** predicted ÷ the channel's typical CTR (1 = typical). */
  vsTypical: number | null;
  confidence: "none" | "low" | "medium" | "high";
  reasons: string[];
  basedOn: number;
}

const POWER_WORDS = /\b(never|stop|secrets?|mistakes?|worst|best|truths?|why|hidden|nobody|finally|actually|wrong)\b/i;

export function titleTraits(title: string): Trait[] {
  const text = title.trim();
  const traits: Trait[] = [];
  const add = (key: string, label: string, test: boolean) => test && traits.push({ key, label });
  add("number", "titles with a number", /\d/.test(text));
  add("question", "titles that ask a question", /\?\s*$/.test(text));
  add("you", "titles that speak to the viewer (you/your)", /\byou(r|'re)?\b/i.test(text));
  add("how-why", "titles starting with how, why or what", /^(how|why|what)\b/i.test(text));
  add("first-person", "first-person titles (I, my, we)", /\b(i|i'm|i've|my|we|our)\b/i.test(text));
  add("brackets", "titles with brackets", /[[(]/.test(text));
  add("caps", "titles with a word in capitals", /\b[A-Z]{3,}\b/.test(text.replace(/\b(AI|USA|UK|DIY|TV|CEO|API|CSS|HTML|NASA)\b/g, "")));
  add("strong-word", "titles with a strong word (never, secret, mistake…)", POWER_WORDS.test(text));
  const length = text.length;
  add("short", "short titles (under 35 characters)", length < 35);
  add("long", "long titles (over 60 characters)", length > 60);
  return traits;
}

export function thumbnailTraitsOf(thumbnail: ThumbnailTraits): Trait[] {
  const words = thumbnail.words === 0 ? "none" : thumbnail.words <= 3 ? "1-3" : thumbnail.words <= 5 ? "4-5" : "6+";
  return [
    { key: `style:${thumbnail.style}`, label: `the ${thumbnail.style} style` },
    { key: `position:${thumbnail.position}`, label: `headlines at the ${thumbnail.position}` },
    { key: `words:${words}`, label: words === "none" ? "pictures without a headline" : `${words} word headlines` },
    { key: `logo:${thumbnail.logo ? "yes" : "no"}`, label: thumbnail.logo ? "thumbnails with the logo" : "thumbnails without the logo" },
  ];
}

const mean = (values: readonly number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/** Videos whose CTR can be trusted. */
export function measured(history: readonly PastVideo[]): PastVideo[] {
  return history.filter((video) => video.impressions >= MIN_IMPRESSIONS && video.ctr > 0 && video.ctr < 1);
}

/**
 * Scores one candidate's traits against the history, using `traitsOf` to
 * read each past video's traits (title traits, or thumbnail traits).
 */
export function scoreTraits(candidate: readonly Trait[], history: readonly PastVideo[], traitsOf: (video: PastVideo) => Trait[] | null): Score {
  const usable = measured(history).flatMap((video) => {
    const traits = traitsOf(video);
    return traits ? [{ video, keys: new Set(traits.map((trait) => trait.key)) }] : [];
  });
  if (usable.length < MIN_HISTORY) {
    return {
      predictedCtr: null,
      vsTypical: null,
      confidence: "none",
      reasons: [`Not enough history yet: ${usable.length} of ${MIN_HISTORY} published videos with click-through data.`],
      basedOn: usable.length,
    };
  }
  const typical = median(usable.map((entry) => entry.video.ctr));
  let factor = 1;
  const reasons: Array<{ weight: number; text: string }> = [];
  for (const trait of candidate) {
    const withIt = usable.filter((entry) => entry.keys.has(trait.key)).map((entry) => entry.video.ctr);
    const without = usable.filter((entry) => !entry.keys.has(trait.key)).map((entry) => entry.video.ctr);
    if (withIt.length < 2 || without.length < 2) continue;
    const lift = mean(withIt) / Math.max(1e-6, mean(without));
    // Shrink towards 1 by sample size: 2 videos count a little, 20 count fully.
    const shrink = withIt.length / (withIt.length + 4);
    const effect = Math.exp(Math.log(Math.min(4, Math.max(0.25, lift))) * shrink);
    factor *= effect;
    if (Math.abs(effect - 1) >= 0.05) {
      reasons.push({
        weight: Math.abs(Math.log(effect)),
        text: `Your ${trait.label} got ${lift >= 1 ? `${lift.toFixed(1)}× the clicks of the rest` : `${Math.round((1 - lift) * 100)}% fewer clicks than the rest`} (${withIt.length} videos).`,
      });
    }
  }
  // No trait moves a prediction beyond 2.5× either way.
  factor = Math.min(2.5, Math.max(0.4, factor));
  const confidence = usable.length >= 25 ? "high" : usable.length >= 10 ? "medium" : "low";
  return {
    predictedCtr: Math.round(typical * factor * 10_000) / 10_000,
    vsTypical: Math.round(factor * 100) / 100,
    confidence,
    reasons: reasons.length ? reasons.sort((a, b) => b.weight - a.weight).slice(0, 3).map((reason) => reason.text) : ["Nothing in your history sets this apart from your usual titles."],
    basedOn: usable.length,
  };
}

export function scoreTitle(title: string, history: readonly PastVideo[]): Score {
  return scoreTraits(titleTraits(title), history, (video) => titleTraits(video.title));
}

export function scoreThumbnail(thumbnail: ThumbnailTraits, history: readonly PastVideo[]): Score {
  const score = scoreTraits(thumbnailTraitsOf(thumbnail), history, (video) => (video.thumbnail ? thumbnailTraitsOf(video.thumbnail) : null));
  if (score.predictedCtr === null) score.reasons = [score.reasons[0]!.replace("published videos", "videos published with a lab thumbnail")];
  return score;
}

/** Plain checks for a title, used before there's history (and shown alongside the score). */
export function titleChecks(title: string): Array<{ ok: boolean; note: string }> {
  const text = title.trim();
  return [
    text.length === 0 ? { ok: false, note: "Empty." } : text.length <= 60 ? { ok: true, note: `${text.length} characters: shows in full on most screens.` } : { ok: false, note: `${text.length} characters: YouTube cuts titles around 60 on phones.` },
    /^[A-Z0-9\s!?.,'-]+$/.test(text) && text.length > 10 ? { ok: false, note: "All capitals reads as shouting." } : { ok: true, note: "Normal capitalisation." },
    /(.)\1{3,}|[!?]{3,}/.test(text) ? { ok: false, note: "Repeated characters or punctuation look like spam." } : { ok: true, note: "No spammy punctuation." },
  ];
}
