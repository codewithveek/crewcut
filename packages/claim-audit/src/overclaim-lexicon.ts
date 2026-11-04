/**
 * Overclaim lexicon (ported from Cutroom). A match makes a claim "weak", not
 * unsupported, unless the cited evidence uses the same word.
 */
export const OVERCLAIM_LEXICON: Record<string, string> = {
  globally: "name the regions, or say 'across borders'",
  anywhere: "name where it works",
  instantly: "say how fast, or 'in one step'",
  "real-time": "say how often it updates",
  realtime: "say how often it updates",
  any: "name what is supported",
  all: "name what is covered",
  never: "say what it avoids, and when",
  always: "say when it happens",
  automatic: "say what triggers it",
  automatically: "say what triggers it",
  effortless: "say what step it removes",
  effortlessly: "say what step it removes",
  secure: "name the protection (e.g. 'encrypted at rest')",
  seamless: "say what it connects",
  seamlessly: "say what it connects",
  best: "say best at what, measured how",
  fastest: "give the measurement and what it was compared with",
  only: "say 'one of the few' unless a source says only",
  first: "cite who says it was first",
  guaranteed: "say what is guaranteed and by whom",
  revolutionary: "say what changed",
  everyone: "say who, or 'most people'",
  "100%": "give the actual figure",
};

/** "all three", "secure by default", "any of the" read as qualified. */
const QUALIFIER_AFTER = /^(of|three|two|four|five|\d+|the\s+(?:same|following)|by\s+default|from)\b/i;

export interface OverclaimHit {
  word: string;
  advice: string;
}

export function findOverclaims(text: string): OverclaimHit[] {
  const hits: OverclaimHit[] = [];
  const lower = text.toLowerCase();
  for (const [word, advice] of Object.entries(OVERCLAIM_LEXICON)) {
    const pattern = new RegExp(`(?<![\\w-])${word.replace(/[.*+?^${}()|[\]\\%]/g, "\\$&")}(?![\\w-])`, "gi");
    for (const match of lower.matchAll(pattern)) {
      const after = lower.slice((match.index ?? 0) + match[0].length).trimStart();
      if (QUALIFIER_AFTER.test(after)) continue;
      hits.push({ word, advice });
      break;
    }
  }
  return hits;
}
