import { defineAction } from "@agent-native/core/action";
import { type LayerInput, addLayer } from "@crewcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description: "Add a freeform layer (text, shape, image, video, code, chart, icon, group or camera) to a clip, with optional keyframes.",
  schema: z.object({
    videoId: z.string(),
    clipId: z.string(),
    layer: z.object({ type: z.string() }).passthrough(),
    index: z.number().int().min(0).optional(),
    returnFull: z.boolean().default(false),
  }),
  run: async ({ videoId, returnFull, clipId, layer, index }, ctx) =>
    runCompositionEdit(
      ctx,
      videoId,
      `Add ${layer.type} layer`,
      (c) => addLayer(c, { clipId, layer: layer as LayerInput, ...(index !== undefined ? { index } : {}) }).composition,
      { returnFull },
    ),
});
