import { type Dossier, type Script, dossierSchema, scriptSchema } from "@proofcut/contracts";
import { describe, expect, it } from "vitest";

import { ApprovalBlockedError, applyFix, assertApprovable, findApprovalBlockers, overrideClaim, suggestFixes } from "./approval-gate";
import { auditClaims, isFactualLine } from "./audit-claims";
import { findOverclaims } from "./overclaim-lexicon";
import { extractNumbers, locateQuote, verifyQuote } from "./text";

const dossier: Dossier = dossierSchema.parse({
  topic: "Why Vite starts fast",
  angle: "It skips bundling in dev",
  sources: [{ id: "s1", kind: "url", title: "Vite docs", url: "https://vite.dev/guide/why", retrievedAt: "2026-11-03T00:00:00Z" }],
  facts: [
    { id: "f1", statement: "Vite serves source over native ESM in dev", sourceId: "s1", quote: "Vite serves source code over native ESM", confidence: "high", verified: true },
    { id: "f2", statement: "esbuild pre-bundles dependencies 10-100x faster", sourceId: "s1", quote: "esbuild pre-bundles dependencies 10-100x faster than JavaScript-based bundlers", confidence: "high", verified: true },
    { id: "f3", statement: "An unverified claim", sourceId: "s1", quote: "made up text", confidence: "low", verified: false },
  ],
});

const script: Script = scriptSchema.parse({
  headline: "Why Vite starts fast",
  beats: [
    { id: "b1", kind: "hook", lines: [{ id: "l1", text: "Your dev server shouldn't take a coffee break." }] },
    {
      id: "b2",
      kind: "mechanism",
      lines: [
        { id: "l2", text: "Vite serves your source over native ESM.", factIds: ["f1"] },
        { id: "l3", text: "Its pre-bundler is 100x faster than JavaScript bundlers.", factIds: ["f2"] },
        { id: "l4", text: "It is 1,000 times faster than Webpack.", factIds: ["f2"] },
        { id: "l5", text: "Startup is always instant on every machine." },
        { id: "l6", text: "It works on any project.", factIds: ["f1"] },
      ],
    },
    { id: "b3", kind: "cta", lines: [{ id: "l7", text: "Try it on your next project." }] },
  ],
});

describe("text helpers", () => {
  it("verifies quotes regardless of whitespace, case and quote style", () => {
    expect(verifyQuote("vite  serves SOURCE code", "Today, Vite serves source code over native ESM.").found).toBe(true);
    expect(verifyQuote("webpack serves", "Vite serves source").found).toBe(false);
    expect(locateQuote("line two\nline three", "line one\nline two\nline three\n")).toEqual({ lineStart: 2, lineEnd: 3 });
  });

  it("extracts numbers in many forms", () => {
    expect(extractNumbers("1,200 runs, 42% faster, 3.5k stars, ten times")).toEqual([1200, 42, 3500, 10]);
  });

  it("finds overclaims but lets qualified uses pass", () => {
    expect(findOverclaims("It always works").map((hit) => hit.word)).toContain("always");
    expect(findOverclaims("all three tools").map((hit) => hit.word)).not.toContain("all");
  });
});

describe("auditClaims", () => {
  const report = auditClaims({ script, dossier, scriptVersion: 1, now: () => new Date("2026-11-03T00:00:00Z") });
  const byLine = Object.fromEntries(report.results.map((result) => [result.lineId, result]));

  it("skips hook and cta lines with nothing checkable", () => {
    expect(byLine.l1).toBeUndefined();
    expect(byLine.l7).toBeUndefined();
    expect(isFactualLine({ id: "l9", text: "It has 3 parts", factIds: [], emphasis: [] }, { kind: "hook" })).toBe(true);
  });

  it("supports a sourced line", () => {
    expect(byLine.l2?.verdict).toBe("supported");
    expect(byLine.l2?.evidence[0]?.url).toBe("https://vite.dev/guide/why");
    expect(byLine.l3?.verdict).toBe("supported");
  });

  it("blocks numbers the evidence doesn't contain", () => {
    expect(byLine.l4?.verdict).toBe("unsupported");
    expect(byLine.l4?.checks.find((check) => check.check === "numbers")?.passed).toBe(false);
  });

  it("blocks factual lines with no source", () => {
    expect(byLine.l5?.verdict).toBe("unsupported");
  });

  it("weakens overclaims", () => {
    expect(byLine.l6?.verdict).toBe("weak");
  });

  it("gates approval until fixed or overridden", () => {
    expect(findApprovalBlockers(report).map((result) => result.lineId)).toEqual(["l4", "l5"]);
    expect(() => assertApprovable(report, { requireAudit: true })).toThrow(ApprovalBlockedError);
    expect(() => assertApprovable(null, { requireAudit: true })).toThrow(ApprovalBlockedError);
    expect(() => overrideClaim(report, { claimId: "claim:l4", reason: "meh", by: "a@b.c" })).toThrow();
    let overridden = overrideClaim(report, { claimId: "claim:l4", reason: "Benchmark is in our own repo README", by: "a@b.c" });
    overridden = overrideClaim(overridden, { claimId: "claim:l5", reason: "Removing this line in the edit", by: "a@b.c" });
    expect(() => assertApprovable(overridden, { requireAudit: true })).not.toThrow();
  });

  it("carries overrides over when the line text is unchanged", () => {
    const overridden = overrideClaim(report, { claimId: "claim:l4", reason: "Benchmark is in our own repo README", by: "a@b.c" });
    const again = auditClaims({ script, dossier, scriptVersion: 2, previous: overridden.results });
    expect(again.results.find((result) => result.lineId === "l4")?.overrideReason).toBeDefined();
  });

  it("suggests mechanical fixes that resolve the flag", () => {
    const flagged = byLine.l4;
    if (!flagged) throw new Error("expected l4");
    const fixes = suggestFixes(flagged, script, dossier);
    const rewrite = fixes.find((fix) => fix.kind === "rewrite");
    expect(rewrite).toBeDefined();
    if (!rewrite) return;
    const fixed = applyFix(script, rewrite);
    const again = auditClaims({ script: fixed, dossier, scriptVersion: 2 });
    const after = again.results.find((result) => result.lineId === "l4");
    // The number now matches the source; "Webpack" still isn't in the evidence, so it stays weak.
    expect(after?.checks.find((check) => check.check === "numbers")?.passed).toBe(true);
    expect(after?.verdict).toBe("weak");
    expect(findApprovalBlockers(again).map((result) => result.lineId)).not.toContain("l4");
  });

  it("offers to cite a matching fact for an unsourced line", () => {
    const unsourced = auditClaims({
      script: scriptSchema.parse({ headline: "Vite", beats: [{ id: "b1", kind: "hook", lines: [{ id: "l1", text: "x" }] }, { id: "b2", kind: "mechanism", lines: [{ id: "l2", text: "Vite serves source code over native ESM, 2 ways." }] }] }),
      dossier,
      scriptVersion: 1,
    });
    const flagged = unsourced.results[0];
    expect(flagged?.verdict).toBe("unsupported");
    expect(flagged?.suggestion).toMatch(/f1/);
  });
});
