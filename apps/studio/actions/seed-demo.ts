import { defineAction } from "@agent-native/core/action";
import { explainPerformance } from "@crewcut/analytics";
import { applyFix, auditClaims } from "@crewcut/claim-audit";
import { DEFAULT_GATE_POLICY, STAGES, type StageStates } from "@crewcut/contracts";
import {
  DEMO_SOURCE,
  approveStage,
  completeStage,
  composeFromScript,
  demoDossier,
  demoIdeas,
  demoMetrics,
  demoPublishedComposition,
  demoPublishedScript,
  demoScript,
  initialStageStates,
  startStage,
} from "@crewcut/pipeline";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireHuman } from "../server/lib/identity.js";
import { nowIso, toJson } from "../server/lib/json.js";
import { runAuditAndQa } from "../server/lib/pipeline-ops.js";
import {
  loadVideo,
  ownership,
  recordApproval,
  saveAudit,
  saveComposition,
  saveDossier,
  saveScript,
  saveStages,
  updateVideo,
} from "../server/lib/store.js";
import { newId, sha256 } from "../server/lib/storage.js";

const DEMO_REASON = "Demo seed";

export default defineAction({
  description: "Load the demo workspace: a sample published video with analytics, and 'Why good motion feels physical' advanced to the chosen stage. Everything is labelled as sample data.",
  schema: z.object({ through: z.enum(["ideas", "script", "composed"]).default("script") }),
  // People-only like approvals: it records human approvals on the demo video.
  // toolCallable: false also keeps agent-written mini-apps (extensions) from calling it.
  agentTool: false,
  uiOnly: true,
  toolCallable: false,
  run: async ({ through }, ctx) => {
    const who = requireHuman(ctx, "Loading the demo");
    const db = getDb();
    const now = nowIso();
    const human = { kind: "human" as const, id: who.email };
    const agent = { kind: "agent" as const, id: "agent" };

    const projectId = newId("prj");
    await db.insert(schema.projects).values({ id: projectId, name: "Demo · Motion explainers", niche: "motion design for developers", gatePolicy: toJson(DEFAULT_GATE_POLICY), isDemo: true, ...ownership(who) });

    // 1. A sample "published" video with seeded metrics and its insights.
    const sampleId = newId("vid");
    let sampleStages: StageStates = initialStageStates();
    for (const stage of STAGES) sampleStages = { ...sampleStages, [stage]: { status: "approved", updatedAt: now, actor: who.email, note: DEMO_REASON } };
    await db.insert(schema.videos).values({
      id: sampleId,
      projectId,
      title: "Easing curves, explained",
      brief: "Sample published video (seeded metrics)",
      ratio: "9:16",
      platforms: toJson(["youtube_shorts"]),
      stages: toJson(sampleStages),
      status: "sample",
      isDemo: true,
      seed: 21,
      ...ownership(who),
    });
    const sample = await loadVideo(sampleId, ctx, "editor");
    await saveScript(sample, demoPublishedScript(), DEMO_REASON);
    const sampleComposition = demoPublishedComposition();
    await saveComposition(sample, sampleComposition, "Published cut (sample)");
    const metrics = demoMetrics();
    for (const window of ["48h", "7d", "28d"] as const) {
      await db.insert(schema.metricSnapshots).values({ id: newId("met"), videoId: sampleId, window, metrics: toJson(metrics[window]), source: "sample", ...ownership(who) });
    }
    for (const insight of explainPerformance({ videoId: sampleId, composition: sampleComposition, metrics: metrics["7d"], window: "7d" })) {
      await db.insert(schema.insights).values({ id: newId("ins"), videoId: sampleId, window: "7d", body: toJson(insight), ...ownership(who) });
    }
    await db.insert(schema.learnings).values([
      { id: newId("lrn"), projectId, scope: "hook", text: "Keep the hook under 3 seconds and 12 words.", evidence: "Sample: 'Easing curves, explained' lost viewers before the hook landed.", ...ownership(who) },
      { id: newId("lrn"), projectId, scope: "pacing", text: "Hold code on screen longer and highlight one line at a time; don't open on code.", evidence: "Sample: the steepest drop came during the code card.", ...ownership(who) },
    ]);

    // 2. The demo video, advanced through the real pipeline functions.
    const videoId = newId("vid");
    let stages = startStage(initialStageStates(), "trend", { now, actor: agent });
    await db.insert(schema.videos).values({
      id: videoId,
      projectId,
      title: "Why good motion feels physical",
      brief: "Explain why spring animations feel physical, with exact numbers creators can use.",
      ratio: "16:9",
      platforms: toJson(["youtube"]),
      ideas: toJson(demoIdeas()),
      stages: toJson(stages),
      isDemo: true,
      seed: 7,
      ...ownership(who),
    });
    const video = await loadVideo(videoId, ctx, "editor");
    stages = completeStage(stages, "trend", { policy: DEFAULT_GATE_POLICY, now, actor: agent, note: "5 ideas ready" });
    if (through === "ideas") {
      await saveStages(videoId, stages);
      return { projectId, sampleVideoId: sampleId, videoId, path: `/videos/${videoId}` };
    }

    stages = approveStage(stages, "trend", { now, actor: human, note: DEMO_REASON });
    await updateVideo(videoId, { pickedIdeaId: "idea-1" });
    await recordApproval(video, { stage: "trend", decision: "approved", reason: DEMO_REASON, subject: "idea idea-1", actor: who });

    const sourceId = newId("src");
    await db.insert(schema.sources).values({
      id: sourceId,
      videoId,
      kind: "document",
      title: DEMO_SOURCE.title,
      publisher: DEMO_SOURCE.publisher,
      content: DEMO_SOURCE.text,
      contentHash: sha256(DEMO_SOURCE.text),
      ...ownership(who),
    });
    const seededDossier = demoDossier(now);
    const dossier = {
      ...seededDossier,
      sources: seededDossier.sources.map((source) => ({ ...source, id: sourceId })),
      facts: seededDossier.facts.map((fact) => ({ ...fact, sourceId })),
    };
    await saveDossier(video, dossier);
    stages = completeStage(startStage(stages, "research", { now, actor: agent }), "research", { policy: DEFAULT_GATE_POLICY, now, actor: agent, note: "8/8 facts verified against their sources" });
    await recordApproval(video, { stage: "research", decision: "notified", reason: "Gate set to notify", actor: { ...video.who, kind: "agent", actorId: "agent" } });

    let script = demoScript();
    let scriptVersion = await saveScript(video, script, "Script draft", { ...video.who, kind: "agent", actorId: "agent" });
    await saveAudit(video, auditClaims({ script, dossier, scriptVersion }));
    stages = completeStage(startStage(stages, "script", { now, actor: agent }), "script", { policy: DEFAULT_GATE_POLICY, now, actor: agent, note: `v${scriptVersion}` });
    await saveStages(videoId, stages);
    if (through === "script") return { projectId, sampleVideoId: sampleId, videoId, path: `/videos/${videoId}` };

    // through === "composed": approve the script, let QA flag l9, apply its fix, compose.
    stages = approveStage(stages, "script", { now, actor: human });
    await recordApproval(video, { stage: "script", decision: "approved", reason: DEMO_REASON, subject: `script v${scriptVersion}`, actor: who });
    video.stages = stages;
    await saveStages(videoId, stages);
    await runAuditAndQa(video, { completeQaStage: true });
    script = applyFix(script, { kind: "cut", label: "Cut this line", lineId: "l9" });
    scriptVersion = await saveScript(video, script, "Fix l9: Cut this line");
    await recordApproval(video, { stage: "qa", decision: "approved", reason: "Applied fix: Cut this line", subject: "claim:l9", actor: who });
    await runAuditAndQa(video, { completeQaStage: true });
    video.stages = approveStage(video.stages, "qa", { now, actor: human });
    await recordApproval(video, { stage: "qa", decision: "approved", reason: DEMO_REASON, actor: who });
    const composition = composeFromScript({ videoId, script, dossier, ratio: "16:9", seed: 7 });
    const version = await saveComposition(video, composition, "Compose video", { ...video.who, kind: "agent", actorId: "agent" });
    video.stages = completeStage(startStage(video.stages, "motion", { now, actor: agent }), "motion", { policy: DEFAULT_GATE_POLICY, now, actor: agent, note: `Composition v${version}` });
    await saveStages(videoId, video.stages);
    return { projectId, sampleVideoId: sampleId, videoId, path: `/videos/${videoId}/edit` };
  },
});
