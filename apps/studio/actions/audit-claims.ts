import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { beginStage, runAuditAndQa } from "../server/lib/pipeline-ops.js";
import { loadVideo } from "../server/lib/store.js";

export default defineAction({
  description:
    "QA agent: audit every claim in the latest script against the dossier, and run QA (hook, pacing, reading speed, licences, platform rules, sameness, motion). Unsupported claims block the QA gate until fixed, cut, or overridden by a person with a reason.",
  schema: z.object({ videoId: z.string() }),
  run: async ({ videoId }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    await beginStage(video, "qa");
    const summary = await runAuditAndQa(video, { completeQaStage: true });
    return {
      ...summary,
      next:
        summary.blockers.length > 0
          ? "For each blocker, use apply-fix (cite a fact, soften, or cut), or send-back to the script stage. Only a person can override."
          : "QA passed. The person approves QA; then compose the video.",
    };
  },
});
