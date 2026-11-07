import { defineAction } from "@agent-native/core/action";
import { stageSchema } from "@crewcut/contracts";
import { approveStage, startStage } from "@crewcut/pipeline";
import { z } from "zod";

import { requireHuman } from "../server/lib/identity.js";
import { nowIso } from "../server/lib/json.js";
import { runAuditAndQa } from "../server/lib/pipeline-ops.js";
import { latestScript, loadVideo, recordApproval, saveStages, updateVideo } from "../server/lib/store.js";
import { UserError } from "../server/lib/errors.js";

/**
 * Human-only: hidden from the agent, MCP and A2A, and re-checked at run time,
 * so no content the agent reads can make it approve its own work.
 */
export default defineAction({
  description: "Approve a pipeline stage's gate (people only). For the trend stage, pass the picked ideaId.",
  schema: z.object({
    videoId: z.string(),
    stage: stageSchema,
    ideaId: z.string().optional().describe("Trend stage: which idea the person picked"),
    note: z.string().max(500).optional(),
  }),
  agentTool: false,
  uiOnly: true,
  toolCallable: false,
  run: async (args, ctx) => {
    const who = requireHuman(ctx, "Approving a stage");
    const video = await loadVideo(args.videoId, ctx, "editor");
    if (args.stage === "trend") {
      const idea = video.ideas.find((candidate) => candidate.id === args.ideaId);
      if (!idea) throw new UserError("Pick one of the ideas to approve the trend stage.");
      await updateVideo(video.row.id, { pickedIdeaId: idea.id, title: idea.title });
    }
    if (args.stage === "publish") {
      throw new UserError("Publishing is approved per post: use the Publish button on the post.");
    }
    video.stages = approveStage(video.stages, args.stage, { now: nowIso(), actor: { kind: "human", id: who.email }, ...(args.note ? { note: args.note } : {}) });
    await saveStages(video.row.id, video.stages);
    const script = args.stage === "script" ? await latestScript(video.row.id) : null;
    await recordApproval(video, {
      stage: args.stage,
      decision: "approved",
      ...(args.note ? { reason: args.note } : {}),
      ...(args.ideaId ? { subject: `idea ${args.ideaId}` } : script ? { subject: `script v${script.version}` } : video.row.compositionVersion && args.stage === "motion" ? { subject: `composition v${video.row.compositionVersion}` } : {}),
      actor: who,
    });

    // Approving the script hands it to QA straight away.
    if (args.stage === "script") {
      video.stages = startStage(video.stages, "qa", { now: nowIso(), actor: { kind: "agent", id: "agent" }, force: true });
      await saveStages(video.row.id, video.stages);
      const summary = await runAuditAndQa(video, { completeQaStage: true });
      return { approved: args.stage, qa: summary, stages: video.stages };
    }
    return { approved: args.stage, stages: video.stages };
  },
});
