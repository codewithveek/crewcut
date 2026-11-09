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
    const next = summary.autopilot?.stopped
      ? `Autopilot stopped after ${summary.autopilot.round} fact-check rounds. Don't continue: tell the person which claims still have no source, in one or two sentences.`
      : summary.blockers.length > 0
        ? summary.autopilot
          ? `Fact-check round ${summary.autopilot.round} of ${summary.autopilot.maxRounds} failed. Fix every blocker in the script (cite a fact, soften the line, or cut it) with apply-fix or write-script, then run audit-claims again.`
          : "For each blocker, use apply-fix (cite a fact, soften, or cut), or send-back to the script stage. Only a person can override."
        : summary.autopilot
          ? "Fact-check passed. Autopilot carries on: compose the video next."
          : "QA passed. The person approves QA; then compose the video.";
    return { ...summary, next };
  },
});
