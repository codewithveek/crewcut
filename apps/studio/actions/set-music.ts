import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description: "Set the music bed from an uploaded asset (or remove it). It spans the video, fades in and out, and ducks under the voice.",
  schema: z.object({
    videoId: z.string(),
    assetId: z.string().nullable(),
    label: z.string().max(80).default("Music bed"),
    volume: z.number().min(0).max(1.5).default(0.5),
  }),
  run: async ({ videoId, assetId, label, volume }, ctx) =>
    runCompositionEdit(ctx, videoId, assetId ? `Music: ${label}` : "Remove music", (composition) => {
      const draft = structuredClone(composition);
      const track = draft.tracks.find((candidate) => candidate.kind === "audio" && candidate.role === "music");
      if (!track || track.kind !== "audio") throw new UserError("This video has no music track.");
      track.clips = assetId
        ? [
            {
              id: "music-bed",
              startMs: 0,
              durationMs: composition.durationMs,
              src: `asset:${assetId}`,
              assetId,
              text: label,
              trimStartMs: 0,
              volume,
              playbackRate: 1,
              fadeInMs: 800,
              fadeOutMs: 1500,
              envelope: [],
              duckUnderVoice: true,
              peaks: [],
            },
          ]
        : [];
      return draft;
    }),
});
