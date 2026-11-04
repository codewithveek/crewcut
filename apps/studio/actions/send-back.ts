import { defineAction } from "@agent-native/core/action";
import { stageSchema } from "@proofcut/contracts";
import { sendBack } from "@proofcut/pipeline";
import { z } from "zod";

import { nowIso } from "../server/lib/json.js";
import { loadVideo, recordApproval, saveStages } from "../server/lib/store.js";

export default defineAction({
  description:
    "Send work back to an earlier stage with a reason (e.g. QA sends the script back because a claim has no source). Resets that stage and everything after it.",
  schema: z.object({
    videoId: z.string(),
    from: stageSchema,
    to: stageSchema,
    reason: z.string().min(4).max(1000),
  }),
  run: async (args, ctx) => {
    const video = await loadVideo(args.videoId, ctx, "editor");
    video.stages = sendBack(video.stages, {
      from: args.from,
      to: args.to,
      reason: args.reason,
      now: nowIso(),
      actor: { kind: video.who.kind === "human" ? "human" : "agent", id: video.who.actorId },
    });
    await saveStages(video.row.id, video.stages);
    await recordApproval(video, { stage: args.from, decision: "sent_back", reason: args.reason, subject: `→ ${args.to}` });
    return { stages: video.stages };
  },
});
