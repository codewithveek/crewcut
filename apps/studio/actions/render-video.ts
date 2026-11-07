import { defineAction } from "@agent-native/core/action";
import { EXPORT_RESOLUTION_IDS } from "@crewcut/composition";
import { z } from "zod";

import { planOf, proContentIn, workspaceOf } from "../server/lib/catalog.js";
import { queueRender } from "../server/lib/render-runner.js";
import { latestComposition, loadVideo } from "../server/lib/store.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description:
    "Render the latest composition to MP4 on a render worker (Chromium + ffmpeg, outside the web process). Returns a render id to follow with get-video. resolution names the short side (480p, 720p, 1080p default, 1440p = 2K, 2160p = 4K; the long side is capped at 4096 px); bigger exports take longer. Captions burn in by default for 9:16 and 1:1; reducedMotion exports swap slides and springs for short crossfades.",
  schema: z.object({
    videoId: z.string(),
    reducedMotion: z.boolean().default(false),
    burnCaptions: z.boolean().optional(),
    resolution: z.enum(EXPORT_RESOLUTION_IDS).optional(),
  }),
  run: async ({ videoId, reducedMotion, burnCaptions, resolution }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const current = await latestComposition(videoId);
    if (!current) throw new UserError("Create the draft video before exporting.");
    // Pro content can be used and edited by anyone; exporting it needs the workspace to have Pro.
    const pro = await proContentIn(current.composition);
    if (pro.length > 0 && (await planOf(workspaceOf({ email: video.row.ownerEmail, orgId: video.row.orgId }))) !== "pro") {
      throw new UserError(`This video uses Pro content (${pro.join(", ")}). Exporting it needs Crewcut Pro for this workspace. Swap those parts for free ones to export now.`);
    }
    const { renderId, mode } = await queueRender({
      video,
      composition: current.composition,
      compositionVersion: current.version,
      reducedMotion,
      burnCaptions: burnCaptions ?? current.composition.ratio !== "16:9",
      ...(resolution ? { resolution } : {}),
    });
    return {
      renderId,
      mode,
      compositionVersion: current.version,
      note: mode === "queue" ? "Waiting to export." : "Exporting. Progress shows here.",
    };
  },
});
