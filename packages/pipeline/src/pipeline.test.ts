import { applyFix, auditClaims, findApprovalBlockers, suggestFixes } from "@crewcut/claim-audit";
import { TRACK_IDS, lintMotion, styleFingerprint, trimClip, requireVisualClip } from "@crewcut/composition";
import { DEFAULT_GATE_POLICY } from "@crewcut/contracts";
import { describe, expect, it } from "vitest";

import { DEMO_SOURCE, demoDossier, demoIdeas, demoScript } from "./demo";
import { composeFromScript } from "./director";
import {
  PipelineError,
  approveStage,
  completeStage,
  currentStage,
  initialStageStates,
  sendBack,
  startStage,
} from "./orchestrator";
import { runQa } from "./qa";
import { applyNarration, estimateLineAudio, solveNarrationTiming } from "./timing";

const NOW = "2026-11-03T12:00:00.000Z";
const human = { kind: "human" as const, id: "victory@example.com" };
const agent = { kind: "agent" as const, id: "agent" };

describe("orchestrator", () => {
  it("runs stages in order and stops at gates", () => {
    let states = initialStageStates();
    expect(() => startStage(states, "script", { now: NOW, actor: agent })).toThrow(PipelineError);
    states = startStage(states, "trend", { now: NOW, actor: agent });
    states = completeStage(states, "trend", { policy: DEFAULT_GATE_POLICY, now: NOW, actor: agent });
    expect(states.trend.status).toBe("awaiting_approval");
    states = approveStage(states, "trend", { now: NOW, actor: human });
    // Research only notifies by default, so it advances on its own.
    states = completeStage(startStage(states, "research", { now: NOW, actor: agent }), "research", { policy: DEFAULT_GATE_POLICY, now: NOW, actor: agent });
    expect(states.research.status).toBe("notified");
    expect(currentStage(states)).toBe("script");
  });

  it("never lets an agent approve", () => {
    let states = completeStage(initialStageStates(), "trend", { policy: DEFAULT_GATE_POLICY, now: NOW, actor: agent });
    expect(() => approveStage(states, "trend", { now: NOW, actor: agent })).toThrow(/Only a person/);
    states = approveStage(states, "trend", { now: NOW, actor: human });
    expect(states.trend.status).toBe("approved");
  });

  it("publish always waits for a person, even if policy says notify", () => {
    const policy = { ...DEFAULT_GATE_POLICY, publish: "notify" as unknown as "approve" };
    const states = completeStage(initialStageStates(), "publish", { policy, now: NOW, actor: agent });
    expect(states.publish.status).toBe("awaiting_approval");
  });

  it("a post from the editor (earlier stages never ran) can be approved only with force", () => {
    let states = startStage(initialStageStates(), "publish", { now: NOW, actor: agent, force: true });
    states = completeStage(states, "publish", { policy: DEFAULT_GATE_POLICY, now: NOW, actor: agent });
    const refusal = (() => {
      try {
        approveStage(states, "publish", { now: NOW, actor: human });
      } catch (error) {
        return error as PipelineError;
      }
    })();
    expect(refusal?.code).toBe("not_ready");
    expect(refusal?.statusCode).toBe(409);
    expect(approveStage(states, "publish", { now: NOW, actor: human, force: true }).publish.status).toBe("approved");
    expect(() => approveStage(states, "publish", { now: NOW, actor: agent, force: true })).toThrow(/Only a person/);
  });

  it("blocked stages can't be approved; QA can send the script back", () => {
    let states = initialStageStates();
    states = completeStage(states, "qa", { policy: DEFAULT_GATE_POLICY, now: NOW, actor: agent, blockedReason: "1 unsupported claim" });
    expect(() => approveStage(states, "qa", { now: NOW, actor: human })).toThrow(/unsupported/);
    states = sendBack(states, { from: "qa", to: "script", reason: "Line l9 has no source", now: NOW, actor: agent });
    expect(states.script.status).toBe("sent_back");
    expect(states.qa.status).toBe("idle");
  });
});

describe("demo pipeline end to end", () => {
  const dossier = demoDossier(NOW);
  const script = demoScript();

  it("seeds five ranked ideas with evidence and a fully verified dossier", () => {
    expect(demoIdeas()).toHaveLength(5);
    expect(dossier.facts.every((fact) => fact.verified)).toBe(true);
    expect(DEMO_SOURCE.text.length).toBeGreaterThan(500);
  });

  it("QA flags exactly the unsourced claim, and its fix clears it", () => {
    const audit = auditClaims({ script, dossier, scriptVersion: 1 });
    const blockers = findApprovalBlockers(audit);
    expect(blockers.map((blocker) => blocker.lineId)).toEqual(["l9"]);
    expect(audit.results.filter((result) => result.verdict === "supported").length).toBeGreaterThanOrEqual(7);

    const fix = suggestFixes(blockers[0]!, script, dossier).find((candidate) => candidate.kind === "cut");
    expect(fix).toBeDefined();
    const fixed = applyFix(script, fix!);
    expect(findApprovalBlockers(auditClaims({ script: fixed, dossier, scriptVersion: 2 }))).toEqual([]);
  });

  it("composes a freeform video whose timing follows the narration", () => {
    const composition = composeFromScript({ videoId: "v1", script, dossier, ratio: "16:9", seed: 3 });
    const scenes = composition.tracks.find((track) => track.id === TRACK_IDS.scenes);
    expect(scenes?.clips.length).toBe(script.beats.length);
    expect(composition.durationMs).toBeGreaterThan(30_000);
    expect(composition.durationMs).toBeLessThan(70_000);
    const captions = composition.tracks.find((track) => track.kind === "caption");
    expect(captions?.clips.length).toBeGreaterThan(5);
    expect(lintMotion(composition).filter((finding) => finding.severity !== "minor")).toEqual([]);
  });

  it("a hand-trimmed clip keeps its length when narration re-syncs", () => {
    const composition = composeFromScript({ videoId: "v1", script, dossier, ratio: "9:16", seed: 3 });
    const clip = requireVisualClip(composition, "scene-2").clip;
    const trimmed = trimClip(composition, { clipId: "scene-2", edge: "end", toMs: clip.startMs + clip.durationMs + 1500, ripple: true });
    const resynced = applyNarration(trimmed, estimateLineAudio(script));
    const after = requireVisualClip(resynced, "scene-2").clip;
    expect(after.timing).toBe("manual");
    expect(after.durationMs).toBe(clip.durationMs + 1500);
  });

  it("QA passes once claims are clean, and flags a look-alike video", () => {
    const audit = auditClaims({ script, dossier, scriptVersion: 1 });
    const composition = composeFromScript({ videoId: "v1", script, dossier, ratio: "16:9", seed: 3 });
    const blocked = runQa({ script, dossier, audit, composition, platforms: ["youtube"] });
    expect(blocked.pass).toBe(false);
    expect(blocked.findings.some((finding) => finding.code === "unsupported_claim")).toBe(true);

    const fixedScript = applyFix(script, { kind: "cut", label: "Cut", lineId: "l9" });
    const cleanAudit = auditClaims({ script: fixedScript, dossier, scriptVersion: 2 });
    const clean = runQa({ script: fixedScript, dossier, audit: cleanAudit, composition, platforms: ["youtube"] });
    expect(clean.pass).toBe(true);

    const twin = runQa({
      script: fixedScript,
      dossier,
      audit: cleanAudit,
      composition,
      platforms: ["youtube"],
      recent: [{ id: "old", title: "Older video", fingerprint: styleFingerprint(composition) }],
    });
    expect(twin.findings.some((finding) => finding.code === "too_similar")).toBe(true);
  });

  it("solves narration timing deterministically", () => {
    const audio = estimateLineAudio(script);
    const solved = solveNarrationTiming(
      [{ clipId: "a", lineIds: ["l1"], timing: "narration", durationMs: 1000, transitionMs: 0 }, { clipId: "b", lineIds: ["l2"], timing: "narration", durationMs: 1000, transitionMs: 500 }],
      audio,
    );
    expect(solved.scenes[0]?.lines[0]?.startMs).toBe(350);
    expect(solved.scenes[1]?.startMs).toBe(solved.scenes[0]!.durationMs);
  });
});
