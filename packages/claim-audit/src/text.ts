/** Text helpers shared by the deterministic checks. */

const STOPWORDS = new Set(
  "a an and are as at be been but by can could did do does for from had has have how if in into is it its just like may more most no not of on or our so such than that the their them then there these they this those to too up us was we were what when where which while who why will with would you your yours about after again also any because before being between both down each few further here him his her into itself me my myself nor off once only other out over own same she should some still through under until very".split(
    " ",
  ),
);

export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Is `quote` present in `sourceText` (whitespace, quote-style and case insensitive)? */
export function verifyQuote(quote: string, sourceText: string): { found: boolean; index: number } {
  const needle = normalizeForMatch(quote).replace(/^["'\s]+|["'\s.,;:]+$/g, "");
  if (needle.length < 3) return { found: false, index: -1 };
  const haystack = normalizeForMatch(sourceText);
  const index = haystack.indexOf(needle);
  return { found: index >= 0, index };
}

/** Line numbers (1-based) where a verified quote starts and ends in the source. */
export function locateQuote(quote: string, sourceText: string): { lineStart: number; lineEnd: number } | null {
  const lines = sourceText.split(/\r?\n/);
  const needle = normalizeForMatch(quote);
  if (!needle) return null;
  // The first line where the quote is complete, then the latest start that still contains it.
  for (let end = 0; end < lines.length; end += 1) {
    for (let start = end; start >= Math.max(0, end - 40); start -= 1) {
      const window = normalizeForMatch(lines.slice(start, end + 1).join(" "));
      if (window.includes(needle)) return { lineStart: start + 1, lineEnd: end + 1 };
    }
  }
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000,
  million: 1_000_000, billion: 1_000_000_000, half: 0.5, twice: 2, double: 2, triple: 3,
};

const SCALE_SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9 };

/** Every number mentioned: digits (with separators, %, k/m/bn, ×) and simple number words. */
export function extractNumbers(text: string): number[] {
  const numbers: number[] = [];
  const pattern = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|m|bn|b)?\b/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = match[1];
    if (!raw) continue;
    const base = Number(raw.replace(/,/g, ""));
    const suffix = match[2]?.toLowerCase();
    numbers.push(suffix ? base * (SCALE_SUFFIX[suffix] ?? 1) : base);
  }
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const value = NUMBER_WORDS[word];
    if (value !== undefined && value > 1) numbers.push(value);
  }
  return numbers;
}

export function numbersMatch(claimed: number, evidence: readonly number[]): boolean {
  return evidence.some((value) => {
    if (value === claimed) return true;
    // Rounded forms: "about 40%" for 41.6, "1.2 million" for 1,180,000.
    const tolerance = Math.max(Math.abs(value) * 0.05, 0.5);
    return Math.abs(value - claimed) <= tolerance && Number.isInteger(claimed) !== Number.isInteger(value);
  });
}

/** Keywords: ≥ 4 letters, not stopwords, lightly stemmed (Cutroom's retrieval). */
export function keywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  return [...new Set(words.filter((word) => !STOPWORDS.has(word)).map(stem))];
}

export function stem(word: string): string {
  return word.replace(/(ings?|ed|es|s)$/, "") || word;
}

export function keywordOverlap(a: string, b: string): number {
  const left = new Set(keywords(a));
  const right = new Set(keywords(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** Capitalised tokens that are likely names (not the first word of a sentence). */
export function properNouns(text: string): string[] {
  const nouns: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const tokens = sentence.match(/[A-Za-z][\w.+-]*/g) ?? [];
    tokens.forEach((token, index) => {
      if (index === 0) return;
      if (/^[A-Z]/.test(token) && !STOPWORDS.has(token.toLowerCase()) && token.length > 1 && token !== "I") nouns.push(token.replace(/[.]+$/, ""));
    });
  }
  return [...new Set(nouns)];
}
