import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { fileUrl } from "../server/lib/blob-store.js";
import { UserError } from "../server/lib/errors.js";
import { readPackaging } from "../server/lib/packaging.js";
import { loadVideo } from "../server/lib/store.js";
import { thumbnailPicture } from "../server/lib/thumbnails.js";

export default defineAction({
  description:
    "Render a thumbnail option (the chosen one by default) to a JPEG from the video's latest version: up to 1280 px on the long side and under YouTube's 2 MB limit. Returns a link to the picture. Publishing renders the chosen thumbnail on its own, so this is for looking at or downloading it.",
  schema: z.object({ videoId: z.string(), thumbnailId: z.string().optional() }),
  run: async ({ videoId, thumbnailId }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const packaging = await readPackaging(videoId);
    const id = thumbnailId ?? packaging.chosenThumbnailId;
    if (!id) throw new UserError("Choose a thumbnail first, or say which one to render.");
    const option = packaging.thumbnails.find((thumbnail) => thumbnail.id === id);
    if (!option) throw new UserError(`No thumbnail option "${id}".`);
    const { fileName, reused } = await thumbnailPicture(video.row, option);
    return { thumbnailId: id, url: await fileUrl("renders", fileName), reused };
  },
});
