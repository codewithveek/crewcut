import { defineAction } from "@agent-native/core/action";
import { removeLayers } from "@crewcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description: "Remove layers from a clip.",
  schema: z.object({ videoId: z.string(), clipId: z.string(), layerIds: z.array(z.string()).min(1), returnFull: z.boolean().default(false) }),
  run: async ({ videoId, returnFull, ...input }, ctx) =>
    runCompositionEdit(ctx, videoId, `Remove ${input.layerIds.length} layer${input.layerIds.length === 1 ? "" : "s"}`, (c) => removeLayers(c, input), { returnFull }),
});
