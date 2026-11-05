import { defineAction } from "@agent-native/core/action";
import { type LayerPatch, updateLayer } from "@crewcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description:
    "Change a layer's properties: text, style, transform (x/y/width/height in % of frame; offsets, sizes and blur in design px), animation, fill, etc. Nested objects merge.",
  schema: z.object({
    videoId: z.string(),
    clipId: z.string(),
    layerId: z.string(),
    patch: z.record(z.string(), z.unknown()),
    returnFull: z.boolean().default(false),
  }),
  run: async ({ videoId, returnFull, clipId, layerId, patch }, ctx) =>
    runCompositionEdit(ctx, videoId, `Edit ${layerId}`, (c) => updateLayer(c, { clipId, layerId, patch: patch as LayerPatch }), { returnFull }),
});
