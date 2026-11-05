import {
  type ActorKind,
  type GateMode,
  type GatePolicy,
  STAGES,
  type Stage,
  type StageStates,
  stageStatesSchema,
} from "@crewcut/contracts";

/**
 * The orchestrator: runs stages in order, stops at gates, and can loop back
 * (QA sends the script back with a reason; analytics seeds the next idea).
 * Pure functions over `StageStates`, so the actions, the UI and tests share it.
 */
export class PipelineError extends Error {
  override readonly name = "PipelineError";
  constructor(
    readonly code: "not_ready" | "human_only" | "blocked" | "invalid" | "not_awaiting",
    message: string,
  ) {
    super(message);
  }
}

export interface Actor {
  kind: ActorKind;
  /** Person email, or "agent". */
  id: string;
}

const DONE: ReadonlySet<string> = new Set(["approved", "notified"]);

export function initialStageStates(): StageStates {
  return stageStatesSchema.parse({});
}

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

export function isStageDone(states: StageStates, stage: Stage): boolean {
  return DONE.has(states[stage].status);
}

/** The first stage that isn't approved or notified — where the video is now. */
export function currentStage(states: StageStates): Stage {
  return STAGES.find((stage) => !isStageDone(states, stage)) ?? "analytics";
}

/** Publish always needs a person, whatever the workspace policy says. */
export function gateFor(policy: GatePolicy, stage: Stage): GateMode {
  if (stage === "publish") return "approve";
  return policy[stage];
}

export function assertCanStart(states: StageStates, stage: Stage): void {
  const index = stageIndex(stage);
  const blocking = STAGES.slice(0, index).find((earlier) => !isStageDone(states, earlier));
  if (blocking) {
    throw new PipelineError("not_ready", `The ${stage} stage can't start until ${blocking} is approved.`);
  }
}

function touch(states: StageStates, stage: Stage, patch: Partial<StageStates[Stage]>, now: string): StageStates {
  return { ...states, [stage]: { ...states[stage], ...patch, updatedAt: now } };
}

export function startStage(states: StageStates, stage: Stage, options: { now: string; actor: Actor; force?: boolean }): StageStates {
  if (!options.force) assertCanStart(states, stage);
  return touch(states, stage, { status: "running", actor: options.actor.id, note: undefined }, options.now);
}

/**
 * Marks a stage's output as ready. Blocked output (e.g. unsupported claims)
 * stops here; otherwise the gate decides: wait for a click, or notify and move on.
 */
export function completeStage(
  states: StageStates,
  stage: Stage,
  options: { policy: GatePolicy; now: string; actor: Actor; blockedReason?: string | undefined; note?: string },
): StageStates {
  if (options.blockedReason) {
    return touch(states, stage, { status: "blocked", note: options.blockedReason, actor: options.actor.id }, options.now);
  }
  const gate = gateFor(options.policy, stage);
  return touch(
    states,
    stage,
    { status: gate === "approve" ? "awaiting_approval" : "notified", note: options.note, actor: options.actor.id },
    options.now,
  );
}

/**
 * A person approves a gate. Agents can never approve — not even when content
 * they read asks them to — so this refuses any non-human actor.
 */
export function approveStage(
  states: StageStates,
  stage: Stage,
  options: { now: string; actor: Actor; note?: string },
): StageStates {
  if (options.actor.kind !== "human") {
    throw new PipelineError("human_only", "Only a person can approve a stage.");
  }
  const status = states[stage].status;
  if (status === "blocked") {
    throw new PipelineError("blocked", states[stage].note ?? `The ${stage} stage is blocked.`);
  }
  if (status !== "awaiting_approval" && status !== "notified") {
    throw new PipelineError("not_awaiting", `The ${stage} stage has nothing waiting for approval (it is ${status}).`);
  }
  assertCanStart(states, stage);
  return touch(states, stage, { status: "approved", actor: options.actor.id, note: options.note }, options.now);
}

/**
 * Sends work back to an earlier stage with a reason. That stage and every
 * stage after it reset, so nothing downstream keeps stale approvals.
 */
export function sendBack(
  states: StageStates,
  options: { from: Stage; to: Stage; reason: string; now: string; actor: Actor },
): StageStates {
  if (stageIndex(options.to) >= stageIndex(options.from)) {
    throw new PipelineError("invalid", "Work can only be sent back to an earlier stage.");
  }
  if (options.reason.trim().length < 4) throw new PipelineError("invalid", "Say why it's being sent back.");
  let next = { ...states };
  for (const stage of STAGES.slice(stageIndex(options.to) + 1)) {
    next = touch(next, stage, { status: "idle", note: undefined }, options.now);
  }
  return touch(next, options.to, { status: "sent_back", note: options.reason, actor: options.actor.id }, options.now);
}

export function failStage(states: StageStates, stage: Stage, options: { now: string; error: string }): StageStates {
  return touch(states, stage, { status: "failed", note: options.error }, options.now);
}

/** Re-opens a stage after its upstream changed (e.g. the script was edited after QA). */
export function invalidateFrom(states: StageStates, stage: Stage, now: string): StageStates {
  let next = { ...states };
  for (const later of STAGES.slice(stageIndex(stage))) {
    if (next[later].status !== "idle") next = touch(next, later, { status: "idle", note: "Upstream changed; re-run." }, now);
  }
  return next;
}

export function pipelineProgress(states: StageStates): { done: number; total: number; current: Stage; waiting: Stage[] } {
  return {
    done: STAGES.filter((stage) => isStageDone(states, stage)).length,
    total: STAGES.length,
    current: currentStage(states),
    waiting: STAGES.filter((stage) => states[stage].status === "awaiting_approval" || states[stage].status === "blocked"),
  };
}
