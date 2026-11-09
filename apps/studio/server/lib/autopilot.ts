import { type GatePolicy, type Stage, type StageStates, gatePolicySchema } from "@crewcut/contracts";
import { currentStage } from "@crewcut/pipeline";
import { desc, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import { nowIso, parseJson, toJson } from "./json.js";

/**
 * Autopilot: a person asks the crew to make the whole video. Every gate up to
 * publishing notifies instead of waiting (the person's switch is the consent,
 * recorded in the approval log), fact-check failures go back to the script
 * until they pass (three rounds at most, then it stops and asks), and the
 * finished video is exported. Publishing always stays with the person.
 *
 * The agent drives the stages from a background chat run; this module keeps
 * the rules on the server so they hold whatever the agent does.
 */

export const AUTOPILOT_MAX_QA_ROUNDS = 3;
/** No new work for this long while making the video counts as stalled (the run stopped). */
export const AUTOPILOT_STALL_MS = 12 * 60 * 1000;
/** Automatic resumes after a stall, before only the person can resume it. */
export const AUTOPILOT_MAX_AUTO_RESUMES = 3;

/** Every gate notifies; publish stays "approve" (the schema and gateFor enforce that). */
export const AUTOPILOT_GATE_POLICY: GatePolicy = gatePolicySchema.parse({ trend: "notify", research: "notify", script: "notify", qa: "notify", motion: "notify", voice: "notify", analytics: "notify" });

export const autopilotSchema = z.object({
  on: z.boolean().default(false),
  /** running: the crew is working · needs_you: it stopped and says why · exporting: the video is being exported · stopped: the person turned it off. */
  status: z.enum(["running", "needs_you", "exporting", "stopped"]).default("running"),
  /** Failed fact-checks in this run (resets when the person resumes). */
  qaRounds: z.number().int().min(0).default(0),
  startedAt: z.string().optional(),
  /** Who switched it on (the consent the approval log points to). */
  startedBy: z.string().optional(),
  resumes: z.number().int().min(0).default(0),
  lastResumeAt: z.string().optional(),
  reason: z.string().max(600).optional(),
  renderId: z.string().optional(),
  /** What the crew decided on the person's behalf, newest last. */
  decisions: z.array(z.object({ at: z.string(), stage: z.string(), text: z.string().max(300) })).max(40).default([]),
});
export type AutopilotState = z.infer<typeof autopilotSchema>;

const OFF: AutopilotState = autopilotSchema.parse({});

export function readAutopilot(row: { autopilot?: string | null }): AutopilotState {
  return parseJson(autopilotSchema, row.autopilot ?? "{}", OFF);
}

/**
 * True while autopilot is steering the pipeline: switched on and working. Not
 * when it stopped for the person, and not once its export has started (from
 * then on the video is the person's again: their edits go through the usual gates).
 */
export function autopilotDriving(state: AutopilotState): boolean {
  return state.on && state.status === "running";
}

export async function saveAutopilot(videoId: string, state: AutopilotState): Promise<void> {
  await getDb().update(schema.videos).set({ autopilot: toJson(state), updatedAt: nowIso() }).where(eq(schema.videos.id, videoId));
}

/** Reads, changes and saves the video's autopilot state (re-read first, so concurrent steps don't overwrite each other). */
export async function updateAutopilot(videoId: string, change: (state: AutopilotState) => AutopilotState): Promise<AutopilotState> {
  const [row] = await getDb().select({ autopilot: schema.videos.autopilot }).from(schema.videos).where(eq(schema.videos.id, videoId)).limit(1);
  const next = change(readAutopilot(row ?? {}));
  await saveAutopilot(videoId, next);
  return next;
}

/** Notes a decision the crew made on the person's behalf (shown on the board when they come back). */
export function withDecision(state: AutopilotState, stage: Stage, text: string): AutopilotState {
  return { ...state, decisions: [...state.decisions, { at: nowIso(), stage, text: text.slice(0, 300) }].slice(-40) };
}

export function startAutopilot(by: string): AutopilotState {
  return autopilotSchema.parse({ on: true, status: "running", startedAt: nowIso(), startedBy: by, qaRounds: 0, resumes: 0, decisions: [] });
}

// ── What the person sees ────────────────────────────────────────────────────

export type AutopilotPhase = "making" | "paused" | "needs_you" | "exporting" | "ready" | "stopped";

export interface AutopilotView {
  on: boolean;
  phase: AutopilotPhase;
  stage: Stage;
  qaRounds: number;
  maxQaRounds: number;
  reason: string | null;
  decisions: AutopilotState["decisions"];
  startedAt: string | null;
  lastActivityAt: string | null;
  resumes: number;
  canAutoResume: boolean;
  renderId: string | null;
}

/** Milliseconds for ISO and Postgres-style ("2026-11-09 10:11:00.1+00") timestamps; NaN when unreadable. */
export function timestampMs(value: string): number {
  let text = value.trim().replace(" ", "T");
  if (/[+-]\d\d$/.test(text)) text += ":00";
  else if (!/(Z|[+-]\d\d:\d\d)$/i.test(text)) text += "Z";
  return Date.parse(text);
}

/** The most recent of several timestamps, by time (their text formats differ, so text order would lie). */
function latest(...values: Array<string | null | undefined>): { at: string; ms: number } | null {
  let best: { at: string; ms: number } | null = null;
  for (const value of values) {
    if (!value) continue;
    const ms = timestampMs(value);
    if (Number.isFinite(ms) && (!best || ms > best.ms)) best = { at: value, ms };
  }
  return best;
}

/**
 * Autopilot as the person sees it, worked out from the stored state and what
 * the crew last did: an export that finished is "ready", one that failed
 * "needs you", and a run with no new work for a while is "paused".
 */
export async function autopilotViews(rows: ReadonlyArray<{ id: string; autopilot: string; stages: string; updatedAt: string }>): Promise<Map<string, AutopilotView>> {
  const views = new Map<string, AutopilotView>();
  // Videos that ran on autopilot at some point (a stopped run still shows what the crew decided).
  const active = rows.map((row) => ({ row, state: readAutopilot(row) })).filter((entry) => Boolean(entry.state.startedAt));
  if (active.length === 0) return views;
  const ids = active.map((entry) => entry.row.id);
  const db = getDb();
  const [renders, sources, scripts, compositions] = await Promise.all([
    db.select({ id: schema.renderJobs.id, videoId: schema.renderJobs.videoId, status: schema.renderJobs.status, error: schema.renderJobs.error, updatedAt: schema.renderJobs.updatedAt }).from(schema.renderJobs).where(inArray(schema.renderJobs.videoId, ids)).orderBy(desc(schema.renderJobs.createdAt)),
    db.select({ videoId: schema.sources.videoId, at: max(schema.sources.retrievedAt) }).from(schema.sources).where(inArray(schema.sources.videoId, ids)).groupBy(schema.sources.videoId),
    db.select({ videoId: schema.scripts.videoId, at: max(schema.scripts.createdAt) }).from(schema.scripts).where(inArray(schema.scripts.videoId, ids)).groupBy(schema.scripts.videoId),
    db.select({ videoId: schema.compositions.videoId, at: max(schema.compositions.createdAt) }).from(schema.compositions).where(inArray(schema.compositions.videoId, ids)).groupBy(schema.compositions.videoId),
  ]);
  const byVideo = <T extends { videoId: string; at: string | null }>(list: T[]) => new Map(list.map((entry) => [entry.videoId, entry.at]));
  const sourceAt = byVideo(sources);
  const scriptAt = byVideo(scripts);
  const compositionAt = byVideo(compositions);
  for (const { row, state } of active) {
    const stages = parseJson(z.record(z.string(), z.unknown()), row.stages, {}) as unknown as StageStates;
    const render = state.renderId ? renders.find((entry) => entry.id === state.renderId) : renders.find((entry) => entry.videoId === row.id);
    const last = latest(row.updatedAt, sourceAt.get(row.id), scriptAt.get(row.id), compositionAt.get(row.id), render?.updatedAt);
    let phase: AutopilotPhase;
    let reason = state.reason ?? null;
    if (!state.on || state.status === "stopped") phase = "stopped";
    else if (state.status === "needs_you") phase = "needs_you";
    else if (state.status === "exporting" && render?.status === "done") phase = "ready";
    else if (state.status === "exporting" && (render?.status === "failed" || render?.status === "cancelled")) {
      phase = "needs_you";
      reason = `The export didn't finish${render.error ? `: ${render.error.slice(0, 200)}` : ""}. Export it again from the editor.`;
    } else {
      const quietFor = last ? Date.now() - last.ms : 0;
      const exporting = state.status === "exporting" && (render?.status === "queued" || render?.status === "running");
      phase = exporting ? "exporting" : quietFor > AUTOPILOT_STALL_MS ? "paused" : state.status === "exporting" ? "exporting" : "making";
    }
    views.set(row.id, {
      on: state.on,
      phase,
      stage: currentStage(stages),
      qaRounds: state.qaRounds,
      maxQaRounds: AUTOPILOT_MAX_QA_ROUNDS,
      reason,
      decisions: state.decisions,
      startedAt: state.startedAt ?? null,
      lastActivityAt: last ? new Date(last.ms).toISOString() : null,
      resumes: state.resumes,
      canAutoResume: phase === "paused" && state.resumes < AUTOPILOT_MAX_AUTO_RESUMES,
      renderId: render?.id ?? null,
    });
  }
  return views;
}

/** One video's autopilot view (null when it never ran on autopilot). */
export async function autopilotView(row: { id: string; autopilot: string; stages: string; updatedAt: string }): Promise<AutopilotView | null> {
  return (await autopilotViews([row])).get(row.id) ?? null;
}

/** The person's videos with autopilot on (newest first), for the watchdog and the bell. */
export async function autopilotVideosOf(owner: { email: string }): Promise<Array<{ id: string; title: string; view: AutopilotView }>> {
  const rows = await getDb()
    .select({ id: schema.videos.id, title: schema.videos.title, autopilot: schema.videos.autopilot, stages: schema.videos.stages, updatedAt: schema.videos.updatedAt })
    .from(schema.videos)
    // Stored as JSON text starting {"on":true,…}: only videos on autopilot.
    .where(sql`${schema.videos.ownerEmail} = ${owner.email} and ${schema.videos.autopilot} like '{"on":true%'`)
    .orderBy(desc(schema.videos.updatedAt))
    .limit(50);
  const withAutopilot = rows.filter((row) => readAutopilot(row).on);
  const views = await autopilotViews(withAutopilot);
  return withAutopilot.flatMap((row) => {
    const view = views.get(row.id);
    return view ? [{ id: row.id, title: row.title, view }] : [];
  });
}
