import { defineAction } from "@agent-native/core/action";
import { ideaSchema } from "@proofcut/contracts";
import { z } from "zod";

import { toJson } from "../server/lib/json.js";
import { finishStage } from "../server/lib/pipeline-ops.js";
import { loadVideo, updateVideo } from "../server/lib/store.js";

export default defineAction({
  description:
    "Trend agent: save 3–5 ranked video ideas, each with evidence (outliers in the niche, search interest, questions people ask, the channel's own winners, or workspace learnings). Use only official APIs and pages the person can open; never invent URLs or metrics. The person then picks one.",
  schema: z.object({
    videoId: z.string(),
    ideas: z.array(ideaSchema).min(1).max(5),
  }),
  run: async ({ videoId, ideas }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const ranked = [...ideas].sort((a, b) => b.score - a.score);
    await updateVideo(videoId, { ideas: toJson(ranked) });
    const status = await finishStage(video, "trend", { note: `${ranked.length} ideas ready` });
    return { saved: ranked.length, status, next: status === "awaiting_approval" ? "Ask the person to pick an idea on the pipeline board." : "Continue to research." };
  },
});
