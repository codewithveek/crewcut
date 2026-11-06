import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { queueRender } from "../server/lib/render-runner.js";
import { latestComposition, loadVideo } from "../server/lib/store.js";

export default defineAction({
  description:
    "Render the latest composition to MP4 on a render worker (Chromium + ffmpeg, outside the web process). Returns a render id to follow with get-video. Captions burn in by default for 9:16 and 1:1; reducedMotion exports swap slides and springs for short crossfades.",
  schema: z.object({
    videoId: z.string(),
    reducedMotion: z.boolean().default(false),
    burnCaptions: z.boolean().optional(),
  }),
  run: async ({ videoId, reducedMotion, burnCaptions }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const current = await latestComposition(videoId);
    if (!current) throw new Error("Create the draft video before exporting.");
    const { renderId, mode } = await queueRender({
      video,
      composition: current.composition,
      compositionVersion: current.version,
      reducedMotion,
      burnCaptions: burnCaptions ?? current.composition.ratio !== "16:9",
    });
    return {
      renderId,
      mode,
      compositionVersion: current.version,
      note: mode === "queue" ? "Waiting to export." : "Exporting. Progress shows here.",
    };
  },
});
