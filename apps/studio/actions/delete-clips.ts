import { defineAction } from "@agent-native/core/action";
import { deleteClips } from "@crewcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description: "Delete clips. With ripple, later clips on the same track move left to close the gaps.",
  schema: z.object({
    videoId: z.string(),
    clipIds: z.array(z.string()).min(1),
    ripple: z.boolean().default(false),
    returnFull: z.boolean().default(false),
  }),
  run: async ({ videoId, returnFull, ...input }, ctx) =>
    runCompositionEdit(
      ctx,
      videoId,
      `${input.ripple ? "Ripple delete" : "Delete"} ${input.clipIds.length} clip${input.clipIds.length === 1 ? "" : "s"}`,
      (c) => deleteClips(c, input),
      { returnFull },
    ),
});
