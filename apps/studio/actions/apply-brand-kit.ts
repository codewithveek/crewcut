import { defineAction } from "@agent-native/core/action";
import { brandKitIsEmpty, withoutBrandLogo } from "@crewcut/composition";
import { z } from "zod";

import { brandWorkspaceOf, prepareBrandEdit, readBrandKit } from "../server/lib/brand.js";
import { UserError } from "../server/lib/errors.js";
import { editComposition, summarizeComposition } from "../server/lib/pipeline-ops.js";
import { latestComposition, loadVideo } from "../server/lib/store.js";

export default defineAction({
  description:
    "Restyle a video with the workspace's brand kit, as one undoable step: its colours and fonts replace the video's palette and type everywhere they were used, and the logo goes in its corner until the ending. Choose parts with colors / fonts / logo (all true by default); logo: false leaves any logo already there. removeLogo: true only takes the brand logo off.",
  schema: z.object({
    videoId: z.string(),
    colors: z.boolean().default(true),
    fonts: z.boolean().default(true),
    logo: z.boolean().default(true),
    removeLogo: z.boolean().default(false),
  }),
  run: async ({ videoId, colors, fonts, logo, removeLogo }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    if (!(await latestComposition(videoId))) throw new UserError("This video has nothing to restyle yet.");
    if (removeLogo) {
      const { version, composition } = await editComposition(video, "Remove brand logo", withoutBrandLogo);
      return { version, applied: ["logo removed"], summary: summarizeComposition(composition) };
    }
    const kit = await readBrandKit(brandWorkspaceOf(video.row));
    if (brandKitIsEmpty(kit)) throw new UserError("There's no brand kit yet. Set your colours, fonts or logo in Settings → Brand first.");
    const { edit, applied } = await prepareBrandEdit(kit, video.row, { colors, fonts, logo });
    if (applied.length === 0) throw new UserError("Nothing to apply: the brand kit has none of the parts you picked.");
    const { version, composition } = await editComposition(video, "Apply brand kit", edit);
    return { version, applied, summary: summarizeComposition(composition) };
  },
});
