import { z } from "zod";

/**
 * Eight specialist agents share one orchestrator. Each stage ends at a gate;
 * the workspace decides which gates need a click and which only notify.
 * Publishing always needs a person, whatever the policy says.
 */
export const STAGES = ["trend", "research", "script", "qa", "motion", "voice", "publish", "analytics"] as const;
export const stageSchema = z.enum(STAGES);
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, { agent: string; job: string; output: string }> = {
  trend: { agent: "Trend", job: "Find topics with evidence", output: "Ranked ideas" },
  research: { agent: "Research", job: "Gather sources and quote the facts", output: "Fact sheet" },
  script: { agent: "Script", job: "Write hook, beats and narration", output: "Script" },
  qa: { agent: "Fact-check", job: "Check claims, pacing, platform rules and originality", output: "Issues with fixes" },
  motion: { agent: "Motion director", job: "Design and animate the video", output: "Draft video" },
  voice: { agent: "Voice & sound", job: "Voiceover, music, captions", output: "Audio tracks" },
  publish: { agent: "Publish", job: "Export, write the post, upload", output: "Posts" },
  analytics: { agent: "Analytics", job: "Explain results, feed the next idea", output: "Insights" },
};

export const stageStatusSchema = z.enum([
  "idle",
  "running",
  "awaiting_approval",
  "approved",
  "notified",
  "sent_back",
  "blocked",
  "failed",
]);
export type StageStatus = z.infer<typeof stageStatusSchema>;

export const gateModeSchema = z.enum(["approve", "notify"]);
export type GateMode = z.infer<typeof gateModeSchema>;

export const gatePolicySchema = z.object({
  trend: gateModeSchema.default("approve"),
  research: gateModeSchema.default("notify"),
  script: gateModeSchema.default("approve"),
  qa: gateModeSchema.default("approve"),
  motion: gateModeSchema.default("approve"),
  voice: gateModeSchema.default("notify"),
  /** Always "approve": enforced in code, not just by default. */
  publish: z.literal("approve").default("approve"),
  analytics: gateModeSchema.default("notify"),
});
export type GatePolicy = z.infer<typeof gatePolicySchema>;
export const DEFAULT_GATE_POLICY: GatePolicy = gatePolicySchema.parse({});

export const stageStateSchema = z.object({
  status: stageStatusSchema.default("idle"),
  updatedAt: z.string().optional(),
  /** Human-readable note: why it's blocked, what was sent back, what ran. */
  note: z.string().max(2000).optional(),
  /** Who last acted (person email or "agent"). */
  actor: z.string().optional(),
});
export type StageState = z.infer<typeof stageStateSchema>;

export const stageStatesSchema = z.object(
  Object.fromEntries(STAGES.map((stage) => [stage, stageStateSchema.prefault({})])) as Record<Stage, z.ZodPrefault<typeof stageStateSchema>>,
);
export type StageStates = z.infer<typeof stageStatesSchema>;

export const actorKindSchema = z.enum(["human", "agent", "system"]);
export type ActorKind = z.infer<typeof actorKindSchema>;

export const approvalDecisionSchema = z.enum(["approved", "sent_back", "override", "rejected", "notified", "published"]);

export const approvalEventSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  stage: stageSchema,
  actorKind: actorKindSchema,
  actor: z.string(),
  decision: approvalDecisionSchema,
  reason: z.string().max(2000).optional(),
  /** What was approved: e.g. script version, composition version. */
  subject: z.string().max(200).optional(),
  createdAt: z.string(),
});
export type ApprovalEvent = z.infer<typeof approvalEventSchema>;
