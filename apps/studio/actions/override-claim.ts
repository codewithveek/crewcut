import { defineAction } from "@agent-native/core/action";
import { overrideClaim } from "@proofcut/claim-audit";
import { z } from "zod";

import { requireHuman } from "../server/lib/identity.js";
import { finishStage } from "../server/lib/pipeline-ops.js";
import { latestAudit, loadVideo, recordApproval, saveAudit } from "../server/lib/store.js";
import { findApprovalBlockers } from "@proofcut/claim-audit";

export default defineAction({
  description: "Override an unsupported claim with a written reason (people only). The reason is logged in the Proof report.",
  schema: z.object({ videoId: z.string(), claimId: z.string(), reason: z.string().min(8).max(500) }),
  agentTool: false,
  uiOnly: true,
  toolCallable: false,
  run: async ({ videoId, claimId, reason }, ctx) => {
    const who = requireHuman(ctx, "Overriding a claim");
    const video = await loadVideo(videoId, ctx, "editor");
    const audit = await latestAudit(videoId);
    if (!audit) throw new Error("No audit to override.");
    const next = overrideClaim(audit, { claimId, reason, by: who.email });
    await saveAudit(video, next);
    await recordApproval(video, { stage: "qa", decision: "override", reason, subject: claimId, actor: who });
    const blockers = findApprovalBlockers(next);
    if (blockers.length === 0 && video.stages.qa.status === "blocked") await finishStage(video, "qa", { note: "All blockers fixed or overridden" });
    return { claimId, remainingBlockers: blockers.length };
  },
});
