import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listVisibleAssets, toAssetDtos } from "../server/lib/assets.js";
import { loadVideo } from "../server/lib/store.js";

export default defineAction({
  description:
    "List media the person can use: uploads for one video, their personal library, or everything they can see. Each asset has an id to reference as `asset:<id>` in image/video layers and audio clips.",
  schema: z.object({
    videoId: z.string().optional().describe("Limit to one video's uploads (scope=video)"),
    scope: z.enum(["video", "library", "all"]).default("all"),
    mediaType: z.enum(["image", "video", "audio"]).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ videoId, scope, mediaType }, ctx) => {
    if (videoId) await loadVideo(videoId, ctx);
    const rows = await listVisibleAssets(ctx, { scope, ...(videoId ? { videoId } : {}) });
    const assets = (await toAssetDtos(rows)).filter((asset) => !mediaType || asset.mediaType === mediaType);
    return { assets };
  },
});
