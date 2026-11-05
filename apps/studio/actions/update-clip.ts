import { defineAction } from "@agent-native/core/action";
import { updateClip } from "@crewcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description: "Change clip-level settings: name, background, timing (narration/manual), volume, fades, ducking, caption text.",
  schema: z.object({ videoId: z.string(), clipId: z.string(), patch: z.record(z.string(), z.unknown()), returnFull: z.boolean().default(false) }),
  run: async ({ videoId, returnFull, clipId, patch }, ctx) =>
    runCompositionEdit(ctx, videoId, `Edit ${clipId}`, (c) => updateClip(c, { clipId, patch: patch as Parameters<typeof updateClip>[1]["patch"] }), { returnFull }),
});
