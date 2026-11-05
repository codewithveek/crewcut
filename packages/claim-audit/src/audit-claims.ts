import {
  type AuditReport,
  type Beat,
  type ClaimCheck,
  type ClaimResult,
  type ClaimVerdict,
  type Dossier,
  type Fact,
  type Script,
  type ScriptLine,
} from "@crewcut/contracts";

import { findOverclaims } from "./overclaim-lexicon";
import { extractNumbers, keywordOverlap, numbersMatch, properNouns } from "./text";

const VERDICT_RANK: Record<ClaimVerdict, number> = { supported: 0, weak: 1, unsupported: 2 };

export function worstVerdict(verdicts: readonly ClaimVerdict[]): ClaimVerdict {
  return verdicts.reduce<ClaimVerdict>((worst, verdict) => (VERDICT_RANK[verdict] > VERDICT_RANK[worst] ? verdict : worst), "supported");
}

/** Lines that state something checkable: numbers, years, absolutes, comparisons, named things. */
const FACTUAL_PATTERN =
  /\d|%|\b(always|never|every|only|first|invented|law|rule|standard|faster|slower|more than|less than|most|fewest|biggest|largest|smallest|percent|times|million|billion|thousand|study|research|according)\b/i;

export function claimIdForLine(lineId: string): string {
  return `claim:${lineId}`;
}

export function isFactualLine(line: ScriptLine, beat: Pick<Beat, "kind">): boolean {
  if (line.factIds.length > 0) return true;
  if ((beat.kind === "hook" || beat.kind === "cta") && !/\d/.test(line.text)) return false;
  return FACTUAL_PATTERN.test(line.text) || properNouns(line.text).length >= 2;
}

export interface AuditClaimsOptions {
  script: Script;
  dossier: Dossier;
  scriptVersion: number;
  /** Earlier results — overrides carry over when a line's text is unchanged. */
  previous?: readonly ClaimResult[];
  now?: () => Date;
}

/**
 * Deterministic claim audit. Every factual line must cite dossier facts whose
 * quotes were verified against the stored source; numbers must appear in the
 * evidence; overclaims and low-confidence facts make a claim weak.
 * A claim that was never checked is never "probably fine".
 */
export function auditClaims(options: AuditClaimsOptions): AuditReport {
  const factsById = new Map(options.dossier.facts.map((fact) => [fact.id, fact]));
  const sourcesById = new Map(options.dossier.sources.map((source) => [source.id, source]));
  const previous = new Map((options.previous ?? []).map((result) => [result.claimId, result]));
  const results: ClaimResult[] = [];

  for (const beat of options.script.beats) {
    for (const line of beat.lines) {
      if (!isFactualLine(line, beat)) continue;
      const claimId = claimIdForLine(line.id);
      const linked = line.factIds.map((id) => factsById.get(id));
      const facts = linked.filter((fact): fact is Fact => fact !== undefined);
      const checks = runChecks(line, linked, facts, options.dossier);
      const verdict = worstVerdict(checks.map((check) => (check.passed ? "supported" : check.blocking ? "unsupported" : "weak")));
      const prior = previous.get(claimId);
      const carriedOverride = prior?.overrideReason && prior.text === line.text ? prior : undefined;
      results.push({
        claimId,
        lineId: line.id,
        text: line.text,
        verdict,
        checks,
        evidence: facts.map((fact) => ({
          factId: fact.id,
          quote: fact.quote,
          sourceId: fact.sourceId,
          ...(sourcesById.get(fact.sourceId)?.url ? { url: sourcesById.get(fact.sourceId)?.url as string } : {}),
        })),
        ...(verdict !== "supported" ? { suggestion: suggestionFor(line, checks, options.dossier) } : {}),
        ...(carriedOverride?.overrideReason ? { overrideReason: carriedOverride.overrideReason } : {}),
        ...(carriedOverride?.overriddenBy ? { overriddenBy: carriedOverride.overriddenBy } : {}),
      });
    }
  }

  return {
    scriptVersion: options.scriptVersion,
    results,
    counts: {
      supported: results.filter((result) => result.verdict === "supported").length,
      weak: results.filter((result) => result.verdict === "weak").length,
      unsupported: results.filter((result) => result.verdict === "unsupported" && !result.overrideReason).length,
      overridden: results.filter((result) => result.overrideReason).length,
    },
    createdAt: (options.now?.() ?? new Date()).toISOString(),
  };
}

function runChecks(line: ScriptLine, linked: Array<Fact | undefined>, facts: Fact[], dossier: Dossier): ClaimCheck[] {
  const checks: ClaimCheck[] = [];
  if (line.factIds.length === 0) {
    checks.push({ check: "has-source", passed: false, blocking: true, detail: "This line states a fact but cites no dossier fact." });
    return checks;
  }
  const missing = line.factIds.filter((_, index) => linked[index] === undefined);
  checks.push({
    check: "has-source",
    passed: missing.length === 0,
    blocking: true,
    detail: missing.length === 0 ? `Cites ${facts.map((fact) => fact.id).join(", ")}.` : `Unknown fact ids: ${missing.join(", ")}.`,
  });
  if (facts.length === 0) return checks;

  const verified = facts.filter((fact) => fact.verified);
  checks.push({
    check: "fact-verified",
    passed: verified.length === facts.length,
    blocking: verified.length === 0,
    detail:
      verified.length === facts.length
        ? "Every cited quote was found in its stored source."
        : `Quote not found in its source for ${facts.filter((fact) => !fact.verified).map((fact) => fact.id).join(", ")}.`,
  });

  const evidenceText = facts.map((fact) => `${fact.quote} ${fact.statement}`).join(" ");
  const claimed = extractNumbers(line.text);
  if (claimed.length > 0) {
    const evidenceNumbers = extractNumbers(evidenceText);
    const unmatched = claimed.filter((value) => !numbersMatch(value, evidenceNumbers));
    checks.push({
      check: "numbers",
      passed: unmatched.length === 0,
      blocking: true,
      detail: unmatched.length === 0 ? "Every number appears in the cited evidence." : `Not in the evidence: ${unmatched.join(", ")}.`,
    });
  }

  const names = properNouns(line.text);
  if (names.length > 0) {
    const haystack = `${evidenceText} ${dossier.topic}`.toLowerCase();
    const unknown = names.filter((name) => !haystack.includes(name.toLowerCase()));
    checks.push({
      check: "entities",
      passed: unknown.length === 0,
      blocking: false,
      detail: unknown.length === 0 ? "Named things appear in the evidence." : `Not named in the evidence: ${unknown.join(", ")}.`,
    });
  }

  const overclaims = findOverclaims(line.text).filter((hit) => !evidenceText.toLowerCase().includes(hit.word));
  if (overclaims.length > 0) {
    checks.push({
      check: "overclaim",
      passed: false,
      blocking: false,
      detail: overclaims.map((hit) => `"${hit.word}": ${hit.advice}`).join("; "),
    });
  }

  if (facts.every((fact) => fact.confidence === "low")) {
    checks.push({ check: "confidence", passed: false, blocking: false, detail: "Only low-confidence facts back this line; it must not carry the story." });
  }
  return checks;
}

function suggestionFor(line: ScriptLine, checks: ClaimCheck[], dossier: Dossier): string {
  const failed = checks.filter((check) => !check.passed);
  const candidates = bestFactsFor(line.text, dossier, 2);
  if (failed.some((check) => check.check === "has-source")) {
    const best = candidates[0];
    return best
      ? `Link ${best.fact.id} ("${truncate(best.fact.quote, 90)}") or soften the line.`
      : "Find a source for this in research, or cut or soften the line.";
  }
  const numbers = failed.find((check) => check.check === "numbers");
  if (numbers) return `Use the figure the source gives, or drop the number. ${numbers.detail}`;
  const overclaim = failed.find((check) => check.check === "overclaim");
  if (overclaim) return `Qualify the absolute: ${overclaim.detail}`;
  return failed.map((check) => check.detail).join(" ");
}

export function bestFactsFor(text: string, dossier: Dossier, limit = 3): Array<{ fact: Fact; score: number }> {
  return dossier.facts
    .map((fact) => ({ fact, score: keywordOverlap(text, `${fact.statement} ${fact.quote}`) + (fact.verified ? 0.05 : 0) }))
    .filter((candidate) => candidate.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}
