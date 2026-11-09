import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { autopilotVideosOf } from "../server/lib/autopilot.js";
import { identity } from "../server/lib/identity.js";

export default defineAction({
  description: "The person's videos on autopilot, with where each one is: making, paused, needs_you (with the reason), exporting or ready.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_input, ctx) => {
    const who = identity(ctx);
    const videos = await autopilotVideosOf(who);
    return { videos: videos.map((video) => ({ id: video.id, title: video.title, ...video.view })) };
  },
});
