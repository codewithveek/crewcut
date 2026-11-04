import type { AuditReport, ClaimResult, Dossier, Script } from "@proofcut/contracts";

import { bestFactsFor } from "./audit-claims";
import { OVERCLAIM_LEXICON, findOverclaims } from "./overclaim-lexicon";
import { extractNumbers } from "./text";

export class ApprovalBlockedError extends Error {
  override readonly name = "ApprovalBlockedError";
  constructor(readonly blockers: ClaimResult[]) {
    super(
      `${blockers.length} unsupported claim${blockers.length === 1 ? "" : "s"} must be fixed or overridden with a reason: ${blockers
        .map((blocker) => `"${blocker.text}"`)
        .join("; ")}`,
    );
  }
}

/** Unsupported claims with no override block approval. Missing audits block too. */
export function findApprovalBlockers(report: AuditReport | null | undefined): ClaimResult[] {
  if (!report) return [];
  return report.results.filter((result) => result.verdict === "unsupported" && !result.overrideReason);
}

export function assertApprovable(report: AuditReport | null | undefined, options: { requireAudit: boolean }): void {
  if (!report && options.requireAudit) {
    throw new ApprovalBlockedError([]);
  }
  const blockers = findApprovalBlockers(report);
  if (blockers.length > 0) throw new ApprovalBlockedError(blockers);
}

export const MIN_OVERRIDE_REASON_LENGTH = 8;

export function overrideClaim(
  report: AuditReport,
  input: { claimId: string; reason: string; by: string },
): AuditReport {
  const reason = input.reason.trim();
  if (reason.length < MIN_OVERRIDE_REASON_LENGTH) {
    throw new Error("Explain the override in a sentence (at least 8 characters).");
  }
  const results = report.results.map((result) =>
    result.claimId === input.claimId ? { ...result, overrideReason: reason, overriddenBy: input.by } : result,
  );
  if (!results.some((result) => result.claimId === input.claimId)) throw new Error(`No claim "${input.claimId}" in this audit`);
  return {
    ...report,
    results,
    counts: {
      ...report.counts,
      unsupported: results.filter((result) => result.verdict === "unsupported" && !result.overrideReason).length,
      overridden: results.filter((result) => result.overrideReason).length,
    },
  };
}

export type ClaimFix =
  | { kind: "link-fact"; label: string; lineId: string; factIds: string[] }
  | { kind: "rewrite"; label: string; lineId: string; text: string }
  | { kind: "cut"; label: string; lineId: string };

/** Concrete, mechanical fixes for a flagged claim — each is a one-click `apply-fix`. */
export function suggestFixes(result: ClaimResult, script: Script, dossier: Dossier): ClaimFix[] {
  const line = script.beats.flatMap((beat) => beat.lines).find((candidate) => candidate.id === result.lineId);
  if (!line) return [];
  const fixes: ClaimFix[] = [];
  const failed = new Set(result.checks.filter((check) => !check.passed).map((check) => check.check));

  if (failed.has("has-source") || failed.has("numbers") || failed.has("fact-verified")) {
    for (const { fact } of bestFactsFor(line.text, dossier, 2)) {
      if (line.factIds.includes(fact.id) || !fact.verified) continue;
      fixes.push({ kind: "link-fact", label: `Cite ${fact.id}: "${fact.quote.slice(0, 70)}${fact.quote.length > 70 ? "…" : ""}"`, lineId: line.id, factIds: [...line.factIds, fact.id] });
    }
  }
  if (failed.has("numbers")) {
    const evidence = dossier.facts.filter((fact) => line.factIds.includes(fact.id) && fact.verified);
    const evidenceNumbers = evidence.flatMap((fact) => extractNumbers(fact.quote));
    const claimed = extractNumbers(line.text);
    const first = claimed[0];
    const replacement = evidenceNumbers[0];
    if (first !== undefined && replacement !== undefined && claimed.length === 1) {
      const rewritten = line.text.replace(/\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?/, formatNumber(replacement));
      if (rewritten !== line.text) fixes.push({ kind: "rewrite", label: `Use the sourced figure (${formatNumber(replacement)})`, lineId: line.id, text: rewritten });
    }
  }
  const overclaims = findOverclaims(line.text);
  if (overclaims.length > 0) {
    let softened = line.text;
    for (const hit of overclaims) {
      const softer = SOFTER[hit.word];
      if (softer !== undefined) softened = softened.replace(new RegExp(`\\b${hit.word}\\b`, "i"), softer).replace(/\s{2,}/g, " ");
    }
    if (softened !== line.text) fixes.push({ kind: "rewrite", label: "Soften the absolute", lineId: line.id, text: softened.trim() });
  }
  fixes.push({ kind: "cut", label: "Cut this line", lineId: line.id });
  return fixes;
}

const SOFTER: Partial<Record<keyof typeof OVERCLAIM_LEXICON, string>> = {
  always: "usually",
  never: "rarely",
  instantly: "quickly",
  all: "most",
  any: "many",
  everyone: "most people",
  best: "a strong",
  fastest: "fast",
  only: "one of the few",
  guaranteed: "designed",
  revolutionary: "new",
  effortless: "simple",
  effortlessly: "simply",
  seamless: "smooth",
  seamlessly: "smoothly",
};

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : String(value);
}

/** Applies a fix to the script, returning a new script. */
export function applyFix(script: Script, fix: ClaimFix): Script {
  const next = structuredClone(script);
  for (const beat of next.beats) {
    const index = beat.lines.findIndex((line) => line.id === fix.lineId);
    if (index < 0) continue;
    const line = beat.lines[index];
    if (!line) continue;
    if (fix.kind === "link-fact") line.factIds = [...new Set(fix.factIds)];
    if (fix.kind === "rewrite") {
      line.text = fix.text;
      delete line.say;
    }
    if (fix.kind === "cut") beat.lines.splice(index, 1);
  }
  next.beats = next.beats.filter((beat) => beat.lines.length > 0);
  return next;
}
