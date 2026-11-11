import { auditClaims, findApprovalBlockers } from "@crewcut/claim-audit";
import { type Composition, clipEndMs, visualTracks } from "@crewcut/composition";
import type { Stage } from "@crewcut/contracts";
import { completeStage, runQa, startStage } from "@crewcut/pipeline";

import { AUTOPILOT_BUDGET_CREDITS, AUTOPILOT_GATE_POLICY, AUTOPILOT_MAX_QA_ROUNDS, autopilotCreditsSpent, autopilotDriving, readAutopilot, updateAutopilot, withDecision } from "./autopilot.js";
import { UserError } from "./errors.js";
import type { Identity } from "./identity.js";
import { nowIso } from "./json.js";
import {
  type VideoRecord,
  gatePolicyOf,
  getProject,
  isVersionConflict,
  latestAudit,
  latestComposition,
  latestScript,
  loadDossier,
  recentFingerprints,
  recordApproval,
  saveAudit,
  saveComposition,
  saveQa,
  saveStages,
} from "./store.js";

const actorOf = (who: Identity) => ({ kind: who.kind === "human" ? ("human" as const) : ("agent" as const), id: who.actorId });

/** Marks a stage as running (forced: agents may redo a stage the person sent back). */
export async function beginStage(video: VideoRecord, stage: Stage): Promise<void> {
  video.stages = startStage(video.stages, stage, { now: nowIso(), actor: actorOf(video.who), force: true });
  await saveStages(video.row.id, video.stages);
}

/** Completes a stage through its gate; notify-gates log a notification event. */
export async function finishStage(video: VideoRecord, stage: Stage, options: { note?: string; blockedReason?: string } = {}): Promise<string> {
  // On autopilot every gate up to publishing notifies: the person's switch was the sign-off.
  const autopilot = readAutopilot(video.row);
  const onAutopilot = autopilotDriving(autopilot);
  const policy = onAutopilot ? AUTOPILOT_GATE_POLICY : gatePolicyOf(await getProject(video.row.projectId));
  video.stages = completeStage(video.stages, stage, {
    policy,
    now: nowIso(),
    actor: actorOf(video.who),
    ...(options.blockedReason ? { blockedReason: options.blockedReason } : {}),
    ...(options.note ? { note: options.note } : {}),
  });
  await saveStages(video.row.id, video.stages);
  const status = video.stages[stage].status;
  // A notify gate completes on its own: the agent did the work, nobody approved it.
  if (status === "notified") {
    const reason = onAutopilot ? `Autopilot, switched on by ${autopilot.startedBy ?? "the owner"}${options.note ? `: ${options.note}` : ""}` : (options.note ?? "No sign-off needed for this step");
    await recordApproval(video, { stage, decision: "notified", reason: reason.slice(0, 1000), actor: { ...video.who, kind: "agent", actorId: "agent" } });
  }
  // Hands-off doesn't mean open-ended: once a run has used its credit limit it stops and asks.
  if (onAutopilot) {
    const since = autopilot.lastResumeAt ?? autopilot.startedAt ?? video.row.createdAt;
    const spent = await autopilotCreditsSpent(video.row.id, since).catch(() => 0);
    if (spent >= AUTOPILOT_BUDGET_CREDITS) {
      const next = await updateAutopilot(video.row.id, (state) =>
        state.status === "running"
          ? { ...withDecision(state, stage, `Stopped at the ${AUTOPILOT_BUDGET_CREDITS}-credit limit for one run.`), status: "needs_you", reason: `This video has used ${Math.round(spent)} AI credits, the limit for one autopilot run (${AUTOPILOT_BUDGET_CREDITS}). Have a look at it, then resume autopilot to let it carry on.` }
          : state,
      );
      video.row = { ...video.row, autopilot: JSON.stringify(next) };
    }
  }
  return status;
}

export interface AuditSummary {
  scriptVersion: number;
  supported: number;
  weak: number;
  unsupported: number;
  overridden: number;
  qaPass: boolean;
  qaScore: number;
  /** On autopilot: which fact-check round this was, and whether autopilot has stopped for the person. */
  autopilot?: { round: number; maxRounds: number; stopped: boolean };
  blockers: Array<{ claimId: string; lineId: string; text: string; suggestion?: string }>;
  findings: Array<{ severity: string; code: string; message: string; fix?: string; where?: string }>;
}

/**
 * The QA agent's deterministic pass: claim audit + QA checks over the latest
 * script and composition. Unsupported claims block the QA gate.
 */
export async function runAuditAndQa(video: VideoRecord, options: { completeQaStage: boolean }): Promise<AuditSummary> {
  const scriptEntry = await latestScript(video.row.id);
  if (!scriptEntry) throw new Error("There's no script to audit yet. Write the script first.");
  const dossier = await loadDossier(video.row.id);
  if (!dossier) throw new Error("There's no research yet. Research the idea before fact-checking.");
  const previous = await latestAudit(video.row.id);
  const report = auditClaims({ script: scriptEntry.script, dossier, scriptVersion: scriptEntry.version, previous: previous?.results ?? [] });
  await saveAudit(video, report);

  const compositionEntry = await latestComposition(video.row.id);
  const project = await getProject(video.row.projectId);
  const qa = runQa({
    script: scriptEntry.script,
    dossier,
    audit: report,
    composition: compositionEntry?.composition ?? null,
    platforms: video.platforms,
    recent: compositionEntry ? await recentFingerprints(video.row.projectId, video.row.id) : [],
    varietyThreshold: project?.varietyThreshold ?? 0.72,
    consistencyRequested: video.row.consistencyRequested,
  });
  await saveQa(video, qa, { script: scriptEntry.version, composition: compositionEntry?.version ?? 0 });

  const blockers = findApprovalBlockers(report);
  // Autopilot counts failed fact-checks: after the last allowed round it stops and asks the person.
  let autopilotRound: AuditSummary["autopilot"];
  if (options.completeQaStage && autopilotDriving(readAutopilot(video.row))) {
    const next = await updateAutopilot(video.row.id, (state) => {
      if (blockers.length === 0) return withDecision(state, "qa", state.qaRounds > 0 ? `Fact-check passed after ${state.qaRounds + 1} rounds.` : "Fact-check passed first time.");
      const rounds = state.qaRounds + 1;
      const lines = blockers.map((blocker) => `“${blocker.text.slice(0, 80)}”`).join(", ");
      const counted = withDecision({ ...state, qaRounds: rounds }, "qa", `Fact-check round ${rounds}: ${blockers.length} unsupported claim${blockers.length === 1 ? "" : "s"} sent back to the script.`);
      return rounds >= AUTOPILOT_MAX_QA_ROUNDS
        ? { ...counted, status: "needs_you", reason: `After ${rounds} fact-check rounds, ${blockers.length} claim${blockers.length === 1 ? " still has" : "s still have"} no source: ${lines}. Fix or cut ${blockers.length === 1 ? "it" : "them"} in the script, then resume autopilot.`.slice(0, 600) }
        : counted;
    });
    video.row = { ...video.row, autopilot: JSON.stringify(next) };
    autopilotRound = { round: next.qaRounds, maxRounds: AUTOPILOT_MAX_QA_ROUNDS, stopped: next.status === "needs_you" };
  }
  if (options.completeQaStage) {
    await finishStage(video, "qa", {
      ...(blockers.length > 0
        ? { blockedReason: `${blockers.length} unsupported claim${blockers.length === 1 ? "" : "s"}: fix, cut, or override with a reason.` }
        : {}),
      note: `Fact-check score ${qa.score}/100: ${report.counts.supported} lines backed by sources, ${report.counts.weak} weak.`,
    });
  }
  return {
    scriptVersion: scriptEntry.version,
    ...report.counts,
    qaPass: qa.pass,
    qaScore: qa.score,
    ...(autopilotRound ? { autopilot: autopilotRound } : {}),
    blockers: blockers.map((blocker) => ({ claimId: blocker.claimId, lineId: blocker.lineId, text: blocker.text, ...(blocker.suggestion ? { suggestion: blocker.suggestion } : {}) })),
    findings: qa.findings.slice(0, 20).map((finding) => ({
      severity: finding.severity,
      code: finding.code,
      message: finding.message,
      ...(finding.fix ? { fix: finding.fix } : {}),
      ...(finding.where ? { where: finding.where } : {}),
    })),
  };
}

/**
 * Applies a pure edit from @crewcut/composition to the latest version and
 * saves the result as the next version — one undoable step, attributed.
 */
export async function editComposition(
  video: VideoRecord,
  label: string,
  edit: (composition: Composition) => Composition,
): Promise<{ version: number; composition: Composition }> {
  // Two edits arriving together (quick edits in the editor, the agent and a
  // person, two tabs) would both read the same latest version and one would
  // overwrite the other. Versions are unique per video, so the loser of that
  // race is refused by the database; it then re-reads and applies its edit on
  // top of the winner's.
  for (let attempt = 0; ; attempt += 1) {
    const current = await latestComposition(video.row.id);
    if (!current) throw new UserError("This video has nothing to edit yet. Ask the motion director to create the draft video first.");
    const next = edit(current.composition);
    try {
      const version = await saveComposition(video, next, label, video.who, { onConflict: "fail" });
      return { version, composition: next };
    } catch (error) {
      // Each round has one winner, so a burst of N edits needs up to N rounds; a short random wait spreads them out.
      if (attempt >= 11 || !isVersionConflict(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 25 * (attempt + 1)));
    }
  }
}


/** A compact view of a composition for the agent (the full JSON is available via get-composition). */
export function summarizeComposition(composition: Composition) {
  return {
    id: composition.id,
    ratio: composition.ratio,
    fps: composition.fps,
    durationMs: composition.durationMs,
    brief: { mood: composition.brief.mood, layoutGrid: composition.brief.layoutGrid, motionSignature: composition.brief.motionSignature, palette: composition.brief.palette, typePairing: composition.brief.typePairing },
    tracks: composition.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      kind: track.kind,
      clips: track.clips.map((clip) => ({
        id: clip.id,
        name: "name" in clip ? clip.name : undefined,
        startMs: clip.startMs,
        endMs: clipEndMs(clip),
        ...("layers" in clip
          ? {
              timing: clip.timing,
              lineIds: clip.lineIds,
              transitionIn: clip.transitionIn?.type,
              layers: clip.layers.map((layer) => ({
                id: layer.id,
                type: layer.type,
                ...(layer.type === "text" ? { text: layer.text.slice(0, 80) } : {}),
                startMs: layer.startMs,
                animated: Object.keys(layer.keyframes),
              })),
            }
          : {}),
        ...("text" in clip && clip.text ? { text: String(clip.text).slice(0, 80) } : {}),
      })),
    })),
    markers: composition.markers,
    sceneCount: visualTracks(composition)[0]?.clips.length ?? 0,
  };
}
