import { z } from "zod";

// ── Ideas (trend agent) ─────────────────────────────────────────────────────

export const ideaEvidenceSchema = z.object({
  kind: z.enum(["outlier", "search-interest", "question", "own-winner", "source", "learning"]),
  label: z.string().min(1).max(240),
  url: z.string().url().optional(),
  /** e.g. "6.2× channel median", "+180% in 30 days" */
  metric: z.string().max(80).optional(),
});

export const ideaSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(3).max(120),
  angle: z.string().min(3).max(400),
  audience: z.string().max(200).default("technical creators and developers"),
  format: z.enum(["short", "long"]).default("short"),
  /** 0–100: how strongly the evidence supports this idea now. */
  score: z.number().min(0).max(100),
  whyNow: z.string().max(400).optional(),
  evidence: z.array(ideaEvidenceSchema).min(1).max(8),
});
export type Idea = z.infer<typeof ideaSchema>;

// ── Sources and dossier (research agent) ───────────────────────────────────

export const sourceSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(["url", "document", "repo", "idea", "script"]),
  title: z.string().min(1).max(300),
  url: z.string().max(2000).optional(),
  publisher: z.string().max(120).optional(),
  retrievedAt: z.string(),
  /** sha256 of the stored (redacted) text. */
  contentHash: z.string().optional(),
  /** Character count of the stored text. */
  length: z.number().int().nonnegative().default(0),
  redactions: z.number().int().nonnegative().default(0),
});
export type Source = z.infer<typeof sourceSchema>;

export const factSchema = z.object({
  id: z.string().regex(/^f\d+$/, "Fact ids are f1, f2, …"),
  statement: z.string().min(3).max(400),
  sourceId: z.string(),
  /** Copied verbatim from the source. Verified mechanically against it. */
  quote: z.string().min(3).max(600),
  /** Line range for repo/document sources. */
  locator: z.object({ lineStart: z.number().int().positive(), lineEnd: z.number().int().positive() }).optional(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  /** Set by build-dossier: was the quote found in the stored source text? */
  verified: z.boolean().default(false),
});
export type Fact = z.infer<typeof factSchema>;

export const dossierSchema = z.object({
  topic: z.string().min(3).max(200),
  angle: z.string().min(3).max(400),
  summary: z.string().max(2000).default(""),
  facts: z.array(factSchema).min(1).max(40),
  sources: z.array(sourceSchema).default([]),
  analogies: z.array(z.string().max(200)).max(8).default([]),
  openQuestions: z.array(z.string().max(300)).max(10).default([]),
});
export type Dossier = z.infer<typeof dossierSchema>;

// ── Script (script agent) ──────────────────────────────────────────────────

export const BEAT_KINDS = ["hook", "stakes", "twist", "context", "mechanism", "proof", "payoff", "cta"] as const;

export const scriptLineSchema = z.object({
  id: z.string().regex(/^l\d+$/, "Line ids are l1, l2, …"),
  /** What is said and captioned. One sentence, ≤ 22 words. */
  text: z.string().min(1).max(240),
  /** Optional respelling for TTS ("two thousand four"). */
  say: z.string().max(300).optional(),
  /** Dossier facts this line relies on. Every factual line needs at least one. */
  factIds: z.array(z.string()).default([]),
  /** 1–2 words captions should highlight. */
  emphasis: z.array(z.string().max(40)).max(3).default([]),
  /** Short on-screen text, if it differs from the narration. */
  onScreen: z.string().max(120).optional(),
});
export type ScriptLine = z.infer<typeof scriptLineSchema>;

export const beatSchema = z.object({
  id: z.string().regex(/^b\d+$/, "Beat ids are b1, b2, …"),
  kind: z.enum(BEAT_KINDS),
  lines: z.array(scriptLineSchema).min(1).max(8),
});
export type Beat = z.infer<typeof beatSchema>;

export const scriptSchema = z.object({
  headline: z.string().min(3).max(60),
  targetSeconds: z.number().min(10).max(900).default(60),
  wordsPerMinute: z.number().min(100).max(220).default(160),
  beats: z.array(beatSchema).min(2).max(16),
  cta: z.string().max(160).optional(),
});
export type Script = z.infer<typeof scriptSchema>;

export function scriptLines(script: Script): ScriptLine[] {
  return script.beats.flatMap((beat) => beat.lines);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function scriptWordCount(script: Script): number {
  return scriptLines(script).reduce((sum, line) => sum + countWords(line.text), 0);
}

export function wordBudget(script: Pick<Script, "targetSeconds" | "wordsPerMinute">): number {
  return Math.round((script.targetSeconds * script.wordsPerMinute) / 60);
}

// ── Claims and verdicts (QA agent, from Cutroom's claim audit) ─────────────

export const claimVerdictSchema = z.enum(["supported", "weak", "unsupported"]);
export type ClaimVerdict = z.infer<typeof claimVerdictSchema>;

export const claimCheckSchema = z.object({
  check: z.enum(["has-source", "fact-verified", "numbers", "entities", "overclaim", "confidence", "on-screen"]),
  passed: z.boolean(),
  blocking: z.boolean(),
  detail: z.string(),
});
export type ClaimCheck = z.infer<typeof claimCheckSchema>;

export const claimResultSchema = z.object({
  claimId: z.string(),
  lineId: z.string(),
  text: z.string(),
  verdict: claimVerdictSchema,
  checks: z.array(claimCheckSchema),
  /** Facts that back the claim, with their verbatim quotes. */
  evidence: z.array(z.object({ factId: z.string(), quote: z.string(), sourceId: z.string(), url: z.string().optional() })),
  suggestion: z.string().optional(),
  overrideReason: z.string().min(8).optional(),
  overriddenBy: z.string().optional(),
});
export type ClaimResult = z.infer<typeof claimResultSchema>;

export const auditReportSchema = z.object({
  scriptVersion: z.number().int().positive(),
  results: z.array(claimResultSchema),
  counts: z.object({ supported: z.number(), weak: z.number(), unsupported: z.number(), overridden: z.number() }),
  createdAt: z.string(),
});
export type AuditReport = z.infer<typeof auditReportSchema>;

// ── QA findings (QA agent, from vid-skills' qa) ────────────────────────────

export const qaFindingSchema = z.object({
  severity: z.enum(["blocker", "major", "minor"]),
  code: z.string(),
  message: z.string(),
  fix: z.string().optional(),
  /** Where: line id, clip id, layer id, platform. */
  where: z.string().optional(),
  area: z.enum(["claims", "hook", "pacing", "reading", "licence", "platform", "sameness", "motion", "audio", "accessibility"]),
});
export type QaFinding = z.infer<typeof qaFindingSchema>;

export const qaReportSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(100),
  findings: z.array(qaFindingSchema),
  metrics: z.record(z.string(), z.number()),
  createdAt: z.string(),
});
export type QaReport = z.infer<typeof qaReportSchema>;
