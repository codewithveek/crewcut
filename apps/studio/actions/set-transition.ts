import { defineAction } from "@agent-native/core/action";
import { TRANSITION_CATALOG, TRANSITION_TYPES, setTransition, transitionSchema } from "@crewcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description: `Set or clear the transition into a clip. Omit durationMs to keep the current length, or pass the type's natural length. Types (natural ms; directions): ${TRANSITION_TYPES.map((type) => {
    const info = TRANSITION_CATALOG[type];
    return `${type} — ${info.description} (${info.durationMs}${info.directions.length ? `; ${info.directions.join("/")}` : ""})`;
  }).join(" | ")}. On spins, left = anticlockwise.`,
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
