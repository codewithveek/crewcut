import {
  type ArtDirectionBrief,
  type AspectRatio,
  type ComposeSceneInput,
  type Composition,
  type IconName,
  type SceneSpec,
  type StyleFingerprint,
  composeVideo,
  generateArtDirectionBrief,
} from "@crewcut/composition";
import { type Beat, type Dossier, type Script, type ScriptLine } from "@crewcut/contracts";
import { claimIdForLine, extractNumbers } from "@crewcut/claim-audit";

import { type LineAudio, applyNarration, estimateLineAudio } from "./timing";

/**
 * The deterministic motion director: turns a script into a first freeform
 * composition when no model is connected, and gives the agent a starting
 * point it can rewrite. Each beat becomes a scene; the recipe is chosen from
 * what the lines say (numbers → big number, steps → flow, quotes → quote…).
 */

const ICON_KEYWORDS: Array<[RegExp, IconName]> = [
  [/fast|speed|quick|instant|latency/i, "zap"],
  [/secur|safe|token|auth|privacy|vault/i, "shield"],
  [/code|repo|api|function|typescript/i, "code"],
  [/data|database|postgres|table/i, "database"],
  [/chart|metric|analytic|retention|growth/i, "trending-up"],
  [/time|minute|second|clock|schedule/i, "clock"],
  [/source|proof|claim|check|verify/i, "circle-check"],
  [/search|find|research/i, "search"],
  [/video|render|frame|clip/i, "video"],
  [/voice|audio|music|sound/i, "mic"],
  [/team|people|user|audience|viewer/i, "users"],
  [/idea|insight|learn/i, "lightbulb"],
  [/motion|animat|spring|move/i, "wand"],
  [/publish|launch|ship|upload/i, "rocket"],
  [/eye|watch|see|look/i, "eye"],
];

export function iconFor(text: string): IconName {
  return ICON_KEYWORDS.find(([pattern]) => pattern.test(text))?.[1] ?? "sparkle";
}

/** Wraps the line's emphasis words in *stars* so recipes accent them. */
export function starEmphasis(line: { text: string; emphasis: readonly string[] }): string {
  let text = line.text;
  for (const word of line.emphasis) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(?<![*\\w])(${escaped})(?![\\w*])`, "i"), "*$1*");
  }
  return text;
}

function shortLabel(text: string, maxWords = 4): string {
  // Drop "· second part" tails and trailing punctuation: "Start critically damped," → "Start critically damped".
  const words = text.replace(/[*!?]/g, "").replace(/\s[·•|]\s.*$/, "").split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ").replace(/[\s,;:.\-–—·]+$/, "");
}

/** A card title: the line's emphasis words when they say something, else its first words. */
function cardTitle(line: ScriptLine): string {
  const emphasis = line.emphasis.find((word) => /[a-z]/i.test(word));
  if (emphasis) return emphasis.charAt(0).toUpperCase() + emphasis.slice(1);
  return shortLabel(line.onScreen ?? line.text, 3);
}

function splitHeadline(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 5) return [text];
  const middle = Math.ceil(words.length / 2);
  return [words.slice(0, middle).join(" "), words.slice(middle).join(" ")];
}

function headlineText(line: ScriptLine): string {
  return starEmphasis({ text: line.onScreen ?? line.text, emphasis: line.emphasis });
}

export function recipeForBeat(beat: Beat, script: Script, dossier: Dossier | null): SceneSpec {
  const [first] = beat.lines;
  if (!first) return { kind: "headline", lines: [script.headline] };
  const lines = beat.lines;
  // A hero number must mean something: a percentage, a multiplier, money, or ≥ 10.
  const numbered = lines.find((line) => {
    const text = line.onScreen ?? line.text;
    return extractNumbers(text).some((value) => value >= 10) || /\d\s*(%|[x×]\b)|\$\d/.test(text);
  });

  switch (beat.kind) {
    case "hook":
      return { kind: "headline", lines: splitHeadline(headlineText(first)) };
    case "cta":
      return { kind: "end", name: script.headline, cta: shortLabel(script.cta ?? first.text, 4) || "Watch next" };
    case "twist":
      return { kind: "headline", eyebrow: "But", lines: splitHeadline(headlineText(first)) };
    case "proof": {
      const fact = dossier?.facts.find((candidate) => first.factIds.includes(candidate.id));
      const source = fact ? dossier?.sources.find((candidate) => candidate.id === fact.sourceId) : undefined;
      if (fact && fact.quote.length <= 160) return { kind: "quote", quote: fact.quote, attribution: source?.publisher ?? source?.title ?? "Source" };
      break;
    }
    default:
      break;
  }
  if (lines.length >= 3 && (beat.kind === "mechanism" || beat.kind === "context")) {
    const steps = lines.slice(0, 4);
    if (lines.some((line) => /\b(then|next|first|finally|step)\b/i.test(line.text))) {
      return { kind: "flow", nodes: steps.map((line) => ({ label: shortLabel(line.onScreen ?? line.text, 3), icon: iconFor(line.text) })) };
    }
    return {
      kind: "cards",
      cards: steps.slice(0, 3).map((line) => ({ icon: iconFor(line.text), title: cardTitle(line), line: line.onScreen ?? line.text })),
    };
  }
  if (numbered) {
    const text = numbered.onScreen ?? numbered.text;
    const value = extractNumbers(text)[0] ?? 0;
    const percent = new RegExp(`${value}\\s*%`).test(text.replace(/,/g, ""));
    const multiplier = /\d\s*[x×]/.test(text);
    return {
      kind: "big-number",
      value,
      suffix: percent ? "%" : multiplier ? "×" : "",
      decimals: Number.isInteger(value) ? 0 : 1,
      label: shortLabel(beat.kind === "mechanism" ? "How it works" : beat.kind, 3).toUpperCase(),
      line: headlineText(numbered),
    };
  }
  if (lines.length >= 2 && beat.kind === "stakes") {
    return { kind: "list", lead: shortLabel(first.text, 5), items: lines.slice(1, 5).map((line) => shortLabel(line.onScreen ?? line.text, 5)) };
  }
  return { kind: "headline", lines: splitHeadline(headlineText(first)) };
}

export function draftScenes(script: Script, dossier: Dossier | null, lineAudio: ReadonlyMap<string, LineAudio>): ComposeSceneInput[] {
  return script.beats.map((beat, index) => {
    const lineIds = beat.lines.map((line) => line.id);
    const speechMs = lineIds.reduce((sum, lineId) => sum + (lineAudio.get(lineId)?.durationMs ?? 1500) + 180, 0);
    return {
      id: `scene-${index + 1}`,
      name: `${beat.kind[0]?.toUpperCase() ?? ""}${beat.kind.slice(1)}`,
      durationMs: Math.max(2400, speechMs + 900),
      beatId: beat.id,
      lineIds,
      claimIds: beat.lines.filter((line) => line.factIds.length > 0).map((line) => claimIdForLine(line.id)),
      timing: "narration" as const,
      recipe: recipeForBeat(beat, script, dossier),
    };
  });
}

export interface ComposeFromScriptOptions {
  videoId: string;
  script: Script;
  dossier: Dossier | null;
  ratio: AspectRatio;
  seed: number;
  brief?: ArtDirectionBrief;
  avoid?: readonly StyleFingerprint[];
  lineAudio?: ReadonlyMap<string, LineAudio>;
  music?: { src: string; label: string };
}

export function composeFromScript(options: ComposeFromScriptOptions): Composition {
  const lineAudio = options.lineAudio ?? estimateLineAudio(options.script);
  const brief = options.brief ?? generateArtDirectionBrief({ seed: options.seed, avoid: options.avoid ?? [] });
  const composition = composeVideo({
    id: options.videoId,
    title: options.script.headline,
    ratio: options.ratio,
    seed: options.seed,
    brief,
    scenes: draftScenes(options.script, options.dossier, lineAudio),
    ...(options.music ? { music: options.music } : {}),
  });
  const emphasis = new Map(options.script.beats.flatMap((beat) => beat.lines.map((line) => [line.id, line.emphasis] as const)));
  return applyNarration(composition, lineAudio, { emphasis });
}
