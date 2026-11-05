import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { latestComposition, loadVideo, saveComposition, updateVideo } from "../server/lib/store.js";

export default defineAction({
  description: "Rename a video (project). The composition title follows so exports and the editor match.",
  schema: z.object({ videoId: z.string(), title: z.string().trim().min(1).max(120) }),
  run: async ({ videoId, title }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    if (video.row.title === title) return { videoId, title, changed: false };
    await updateVideo(videoId, { title });
    const latest = await latestComposition(videoId);
    if (latest && latest.composition.title !== title) {
      await saveComposition(video, { ...latest.composition, title }, `Rename to “${title.slice(0, 60)}”`);
    }
    return { videoId, title, changed: true };
  },
});
