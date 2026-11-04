import { defineAction } from "@agent-native/core/action";
import { type ClipInput, addClip } from "@proofcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

export default defineAction({
  description:
    "Add a clip to a track. Visual clips take `layers`; audio clips take `src` (asset:<id>); caption clips take `text` and `words`.",
  schema: z.object({
    videoId: z.string(),
    trackId: z.string(),
    clip: z.object({ id: z.string().optional(), startMs: z.number().min(0), durationMs: z.number().min(1) }).passthrough(),
    ripple: z.boolean().default(false),
    returnFull: z.boolean().default(false),
  }),
  run: async ({ videoId, returnFull, trackId, clip, ripple }, ctx) =>
    runCompositionEdit(ctx, videoId, `Add clip to ${trackId}`, (c) => addClip(c, { trackId, clip: clip as ClipInput, ripple }).composition, { returnFull }),
});
