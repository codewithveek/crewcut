import { defineAction } from "@agent-native/core/action";
import { splitClip } from "@proofcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description: "Split a clip at a time (usually the playhead) into two independently editable clips.",
  schema: z.object({ videoId: z.string(), clipId: z.string(), atMs: z.number().min(0), returnFull: z.boolean().default(false) }),
  run: async ({ videoId, returnFull, ...input }, ctx) =>
    runCompositionEdit(ctx, videoId, `Split ${input.clipId} at ${Math.round(input.atMs)} ms`, (c) => splitClip(c, input).composition, { returnFull }),
});
