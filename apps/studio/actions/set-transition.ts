import { defineAction } from "@agent-native/core/action";
import { setTransition, transitionSchema } from "@proofcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description: "Set or clear the transition into a clip (cut, crossfade, blur-crossfade, push, slide, zoom-through, wipe, scale-fade).",
  schema: z.object({
    videoId: z.string(),
    clipId: z.string(),
    transition: transitionSchema.partial().nullable(),
    returnFull: z.boolean().default(false),
  }),
  run: async ({ videoId, returnFull, ...input }, ctx) =>
    runCompositionEdit(
      ctx,
      videoId,
      input.transition ? `Transition ${input.transition.type ?? ""} into ${input.clipId}` : `Clear transition into ${input.clipId}`,
      (c) => setTransition(c, input),
      { returnFull },
    ),
});
