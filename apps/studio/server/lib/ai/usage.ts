import { getDb, schema } from "../../db/index.js";
import { workspaceOf } from "../catalog.js";
import { spendCredits } from "../credits.js";
import { nowIso } from "../json.js";
import { millicreditsForCost } from "../plans.js";
import { newId } from "../storage.js";

export type UsageSource = "managed" | "byok" | "deployment";

export interface UsageRecord {
  ownerEmail: string;
  orgId: string | null;
  source: UsageSource;
  /** llm: model calls (tokens) · voice: voice-overs (units = characters) · transcription: speech-to-text (units = seconds of audio). */
  kind: "llm" | "voice" | "transcription";
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  units?: number;
  costMicros: number;
  videoId?: string;
  stage?: string;
  threadId?: string;
  runId?: string;
  durationMs?: number;
  error?: string;
}

/**
 * Log one call and, for Crewcut AI, charge its credits. Never throws: a
 * logging failure must not break the person's work, so it is reported instead.
 * Returns the credits charged, in thousandths.
 */
export async function recordAiUsage(record: UsageRecord): Promise<number> {
  const workspace = workspaceOf({ email: record.ownerEmail, orgId: record.orgId });
  const millicredits = record.source === "managed" ? millicreditsForCost(record.costMicros) : 0;
  const id = newId("use");
  try {
    await getDb()
      .insert(schema.aiUsage)
      .values({
        id,
        workspace,
        ownerEmail: record.ownerEmail,
        orgId: record.orgId,
        source: record.source,
        kind: record.kind,
        provider: record.provider,
        model: record.model,
        inputTokens: Math.round(record.inputTokens ?? 0),
        outputTokens: Math.round(record.outputTokens ?? 0),
        cacheReadTokens: Math.round(record.cacheReadTokens ?? 0),
        cacheWriteTokens: Math.round(record.cacheWriteTokens ?? 0),
        units: Math.round(record.units ?? 0),
        costMicros: Math.round(record.costMicros),
        millicredits,
        videoId: record.videoId ?? null,
        stage: record.stage ?? "chat",
        threadId: record.threadId ?? null,
        runId: record.runId ?? null,
        durationMs: Math.round(record.durationMs ?? 0),
        error: record.error?.slice(0, 500) ?? null,
        createdAt: nowIso(),
      });
    if (millicredits > 0) {
      const what = record.kind === "voice" ? "Voice-over" : record.kind === "transcription" ? "Captions from speech" : `AI (${record.model})`;
      await spendCredits(workspace, millicredits, `usage:${id}`, `${what}${record.stage ? ` · ${record.stage}` : ""}`);
    }
  } catch (error) {
    console.error("[crewcut-ai] Could not record AI usage:", error instanceof Error ? error.message : error);
  }
  return millicredits;
}
