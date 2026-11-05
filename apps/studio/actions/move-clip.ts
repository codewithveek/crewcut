import { defineAction } from "@agent-native/core/action";
import { moveClip } from "@crewcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description: "Move a clip to a new start time, optionally onto another track of the same kind. Overlaps are rejected.",
  schema: z.object({
    videoId: z.string(),
    clipId: z.string(),
    startMs: z.number().min(0),
    trackId: z.string().optional(),
    returnFull: z.boolean().default(false),
  }),
  run: async ({ videoId, returnFull, ...input }, ctx) =>
    runCompositionEdit(ctx, videoId, `Move ${input.clipId} → ${Math.round(input.startMs)} ms`, (c) => moveClip(c, input), { returnFull }),
});
