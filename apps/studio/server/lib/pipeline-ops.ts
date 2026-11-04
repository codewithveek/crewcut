import { auditClaims, findApprovalBlockers } from "@proofcut/claim-audit";
import { type Composition, clipEndMs, visualTracks } from "@proofcut/composition";
import type { Stage } from "@proofcut/contracts";
import { completeStage, runQa, startStage } from "@proofcut/pipeline";

import type { Identity } from "./identity.js";
import { nowIso } from "./json.js";
import {
  type VideoRecord,
  gatePolicyOf,
  getProject,
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
  const project = await getProject(video.row.projectId);
  video.stages = completeStage(video.stages, stage, {
    policy: gatePolicyOf(project),
    now: nowIso(),
    actor: actorOf(video.who),
    ...(options.blockedReason ? { blockedReason: options.blockedReason } : {}),
    ...(options.note ? { note: options.note } : {}),
  });
  await saveStages(video.row.id, video.stages);
  const status = video.stages[stage].status;
  // A notify gate completes on its own: the agent did the work, nobody approved it.
  if (status === "notified") {
    await recordApproval(video, { stage, decision: "notified", reason: options.note ?? "Gate set to notify", actor: { ...video.who, kind: "agent", actorId: "agent" } });
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
  if (!dossier) throw new Error("There's no research dossier yet. Build the dossier before auditing claims.");
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
  if (options.completeQaStage) {
    await finishStage(video, "qa", {
      ...(blockers.length > 0
        ? { blockedReason: `${blockers.length} unsupported claim${blockers.length === 1 ? "" : "s"}: fix, cut, or override with a reason.` }
        : {}),
      note: `QA score ${qa.score}; ${report.counts.supported} supported, ${report.counts.weak} weak.`,
    });
  }
  return {
    scriptVersion: scriptEntry.version,
    ...report.counts,
    qaPass: qa.pass,
    qaScore: qa.score,
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
 * Applies a pure edit from @proofcut/composition to the latest version and
 * saves the result as the next version — one undoable step, attributed.
 */
export async function editComposition(
  video: VideoRecord,
  label: string,
  edit: (composition: Composition) => Composition,
): Promise<{ version: number; composition: Composition }> {
  const current = await latestComposition(video.row.id);
  if (!current) throw new Error("This video has no composition yet. Run compose-video first.");
  const next = edit(current.composition);
  const version = await saveComposition(video, next, label);
  return { version, composition: next };
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
