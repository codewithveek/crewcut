import { defineAction } from "@agent-native/core/action";
import { trimClip } from "@crewcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description:
    "Trim a clip's start or end to an exact millisecond. Ripple closes the gap on the same track. A narration-timed clip unlocks to manual timing.",
  schema: z.object({
    videoId: z.string(),
    clipId: z.string(),
    edge: z.enum(["start", "end"]),
    toMs: z.number().min(0),
    ripple: z.boolean().default(false),
    returnFull: z.boolean().default(false),
  }),
  run: async ({ videoId, returnFull, ...input }, ctx) =>
    runCompositionEdit(ctx, videoId, `Trim ${input.clipId} ${input.edge} → ${Math.round(input.toMs)} ms`, (c) => trimClip(c, input), { returnFull }),
});
