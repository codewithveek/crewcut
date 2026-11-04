/**
 * A tiny, deterministic syntax tokenizer for code layers — no WASM, no async
 * loading, so preview and render match frame for frame.
 */
export type TokenKind = "keyword" | "string" | "comment" | "number" | "function" | "type" | "punctuation" | "property" | "plain";

export interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set(
  "abstract as async await break case catch class const continue debugger def default del delete do elif else enum except export extends false final finally fn for from func function go if impl implements import in instanceof interface is lambda let loop match mod module mut new nil none not null of or package pass private protected pub public raise readonly return self static struct super switch this throw true try type typeof undefined use var void while with yield".split(
    " ",
  ),
);

const PATTERNS: Array<[TokenKind, RegExp]> = [
  ["comment", /^(\/\/.*|#(?![\w-]).*|\/\*[\s\S]*?\*\/)/],
  ["string", /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/],
  ["number", /^(0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?(?:px|ms|s|%|em|rem|vh|vw)?)/i],
  ["plain", /^\s+/],
  ["property", /^\.[A-Za-z_][\w-]*/],
  ["function", /^[A-Za-z_$][\w$]*(?=\s*\()/],
  ["plain", /^[A-Za-z_$][\w$-]*/],
  ["punctuation", /^[{}()[\];,.:<>=+\-*/%!&|^~?@]+/],
];

export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let rest = line;
  while (rest.length > 0) {
    let matched = false;
    for (const [kind, pattern] of PATTERNS) {
      const match = pattern.exec(rest);
      if (!match?.[0]) continue;
      const text = match[0];
      let resolved: TokenKind = kind;
      if (kind === "plain" && /^[A-Za-z_$]/.test(text)) {
        if (KEYWORDS.has(text)) resolved = "keyword";
        else if (/^[A-Z]/.test(text)) resolved = "type";
      }
      tokens.push({ text, kind: resolved });
      rest = rest.slice(text.length);
      matched = true;
      break;
    }
    if (!matched) {
      tokens.push({ text: rest[0] ?? "", kind: "plain" });
      rest = rest.slice(1);
    }
  }
  return tokens;
}

export const CODE_THEMES = {
  dark: {
    background: "#0f1117",
    chrome: "#171a22",
    border: "#ffffff14",
    gutter: "#4b5263",
    highlight: "#ffffff0f",
    colors: { keyword: "#c792ea", string: "#c3e88d", comment: "#636d83", number: "#f78c6c", function: "#82aaff", type: "#ffcb6b", punctuation: "#89ddff", property: "#80cbc4", plain: "#e6e9ef" },
  },
  light: {
    background: "#ffffff",
    chrome: "#f3f3f1",
    border: "#0000001a",
    gutter: "#a0a1a7",
    highlight: "#0000000a",
    colors: { keyword: "#a626a4", string: "#50a14f", comment: "#a0a1a7", number: "#986801", function: "#4078f2", type: "#c18401", punctuation: "#383a42", property: "#0184bc", plain: "#24292f" },
  },
} as const satisfies Record<string, { background: string; chrome: string; border: string; gutter: string; highlight: string; colors: Record<TokenKind, string> }>;
