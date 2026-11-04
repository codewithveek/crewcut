import { defineAction } from "@agent-native/core/action";
import { animatablePropertySchema, easingSchema, removeKeyframe, setKeyframe } from "@proofcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description:
    "Set (or remove) a keyframe on a layer property at a layer-relative time. The easing shapes the segment arriving at this keyframe: entrance (ease-out), move (ease-in-out), exit, linear, hold, spring-snappy/smooth/gentle/momentum/bouncy, or {spring:{dampingRatio,response}}.",
  schema: z.object({
    videoId: z.string(),
    clipId: z.string(),
    layerId: z.string(),
    property: animatablePropertySchema,
    atMs: z.number(),
    value: z.number().optional(),
    easing: easingSchema.optional(),
    remove: z.boolean().default(false),
    returnFull: z.boolean().default(false),
  }),
  run: async ({ videoId, returnFull, remove, value, easing, ...input }, ctx) =>
    runCompositionEdit(
      ctx,
      videoId,
      `${remove ? "Remove keyframe" : "Keyframe"} ${input.property} on ${input.layerId} @ ${Math.round(input.atMs)} ms`,
      (c) => {
        if (remove) return removeKeyframe(c, input);
        if (value === undefined) throw new Error("Pass a value (or remove: true).");
        return setKeyframe(c, { ...input, value, ...(easing ? { easing } : {}) });
      },
      { returnFull },
    ),
});
