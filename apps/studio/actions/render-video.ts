import { defineAction } from "@agent-native/core/action";
import { EXPORT_RESOLUTION_IDS, EXPORT_RESOLUTIONS, type ExportResolution, hasCrewcutEnding, withCrewcutEnding } from "@crewcut/composition";
import { z } from "zod";

import { autopilotDriving, readAutopilot, updateAutopilot, withDecision } from "../server/lib/autopilot.js";
import { planOf, proContentIn, workspaceOf } from "../server/lib/catalog.js";
import { planFor } from "../server/lib/plan-limits.js";
import { MAX_EXPORT_MINUTES } from "../server/lib/plans.js";
import { queueRender } from "../server/lib/render-runner.js";
import { latestComposition, loadVideo } from "../server/lib/store.js";
import { UpgradeRequiredError, UserError } from "../server/lib/errors.js";

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
      throw new UpgradeRequiredError("pro-content", `This video uses Pro content: ${pro.join(", ")}. Exporting it needs Creator or Studio; swap those parts for free ones to export on Free.`);
    }
    // Free exports are 720p at most and end on the Crewcut ending card (added
    // for this export only; the saved video doesn't change).
    const plan = await planFor({ email: video.row.ownerEmail, orgId: video.row.orgId });
    // Length is a plan limit: a longer video can still be made and edited, just not exported on this plan.
    const minutes = current.composition.durationMs / 60_000;
    const allowed = MAX_EXPORT_MINUTES[plan.id];
    if (minutes > allowed) {
      const reason = `${plan.name} exports videos up to ${allowed} minutes, and this one is ${Math.ceil(minutes)}.`;
      if (plan.id === "studio") throw new UserError(`${reason} Split it into parts and export each.`);
      throw new UpgradeRequiredError("export-length", `${reason} ${plan.id === "free" ? "Creator exports up to 60 minutes and Studio up to 3 hours." : "Studio exports up to 3 hours."}`);
    }
    const limits: string[] = [];
    let size: ExportResolution | undefined = resolution;
    const shortSideOf = (id: ExportResolution | undefined) => EXPORT_RESOLUTIONS.find((entry) => entry.id === id)?.shortSide ?? 1080;
    if (shortSideOf(size) > plan.maxExportHeight) {
      size = [...EXPORT_RESOLUTIONS].reverse().find((entry) => entry.shortSide <= plan.maxExportHeight)?.id;
      limits.push(`${plan.name} exports up to ${size ?? "720p"}; Creator and Studio export up to 4K.`);
    }
    let composition = current.composition;
    if (plan.endingRequired && !hasCrewcutEnding(composition)) {
      composition = withCrewcutEnding(composition);
      limits.push(`${plan.name} videos end with the Crewcut ending card.`);
    }
    const { renderId, mode } = await queueRender({
      video,
      composition,
      compositionVersion: current.version,
      reducedMotion,
      burnCaptions: burnCaptions ?? current.composition.ratio !== "16:9",
      ...(size ? { resolution: size } : {}),
      priority: plan.priorityRenders,
    });
    // On autopilot this is the last step: the video is ready once this export finishes.
    if (autopilotDriving(readAutopilot(video.row))) {
      await updateAutopilot(video.row.id, (state) => withDecision({ ...state, status: "exporting", renderId }, "publish", `Exporting version ${current.version}${resolution ? ` at ${resolution}` : ""}.`));
    }
    return {
      renderId,
      mode,
      compositionVersion: current.version,
      note: [mode === "queue" ? "Waiting to export." : "Exporting. Progress shows here.", ...limits].join(" "),
    };
  },
});
