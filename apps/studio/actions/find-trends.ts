import { defineAction } from "@agent-native/core/action";
import { ideaSchema } from "@crewcut/contracts";
import { z } from "zod";

import { autopilotDriving, readAutopilot, updateAutopilot, withDecision } from "../server/lib/autopilot.js";
import { toJson } from "../server/lib/json.js";
import { finishStage } from "../server/lib/pipeline-ops.js";
import { loadVideo, updateVideo } from "../server/lib/store.js";

export default defineAction({
  description:
    "Trend agent: save 3–5 ranked video ideas, each with evidence (outliers in the niche, search interest, questions people ask, the channel's own winners, or workspace learnings). Use only official APIs and pages the person can open; never invent URLs or metrics. The person then picks one; on autopilot the top-scored idea is picked automatically, so score honestly.",
  schema: z.object({
    videoId: z.string(),
    ideas: z.array(ideaSchema).min(1).max(5),
  }),
  run: async ({ videoId, ideas }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const ranked = [...ideas].sort((a, b) => b.score - a.score);
    await updateVideo(videoId, { ideas: toJson(ranked) });
    // Autopilot picks the strongest idea itself, and says why, instead of waiting for a click.
    const top = ranked[0];
    if (top && autopilotDriving(readAutopilot(video.row))) {
      await updateVideo(videoId, { pickedIdeaId: top.id, title: top.title });
      const next = await updateAutopilot(videoId, (state) => withDecision(state, "trend", `Picked “${top.title}” (score ${top.score}) out of ${ranked.length} ideas.`));
      video.row = { ...video.row, pickedIdeaId: top.id, title: top.title, autopilot: JSON.stringify(next) };
    }
    const status = await finishStage(video, "trend", { note: `${ranked.length} ideas ready` });
    return {
      saved: ranked.length,
      status,
      ...(video.row.pickedIdeaId && status === "notified" ? { picked: { id: video.row.pickedIdeaId, title: video.row.title } } : {}),
      next: status === "awaiting_approval" ? "Ask the person to pick an idea on the pipeline board." : "Continue to research the picked idea.",
    };
  },
});
