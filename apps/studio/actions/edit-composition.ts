import { defineAction } from "@agent-native/core/action";
import { applyCompositionOp, compositionOpSchema } from "@crewcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

/**
 * The one batched edit endpoint. The op list lives in @crewcut/composition
 * so the editor applies the exact same functions optimistically.
 */
export default defineAction({
  description:
    "Apply several composition edits as ONE undoable step (e.g. 'make the hook punchier' = shorten a clip, retime keyframes, swap a preset). Ops run in order; if any fails, nothing is saved. " +
    "Besides trim/move/split/delete/keyframes/layers/transitions, ops include add-media-clip (asset → timeline), add-element-clip (text/shape/sticker as its own clip), add-caption / update-caption / set-caption-style, duplicate-clips, paste-clips, set-clip-speed, add-track / remove-track / reorder-track, update-clip (volume, fades, speed, filter, adjust, background), and set-format (aspect ratio 16:9, 9:16, 1:1, 4:5, 4:3, 3:4, 21:9, 2:3).",
  schema: z.object({
    videoId: z.string(),
    label: z.string().min(2).max(120).describe("What this step did, shown in history"),
    ops: z.array(compositionOpSchema).min(1).max(60),
    returnFull: z.boolean().default(false),
  }),
  run: async ({ videoId, label, ops, returnFull }, ctx) =>
    runCompositionEdit(ctx, videoId, label, (composition) => ops.reduce(applyCompositionOp, composition), { returnFull }),
});
