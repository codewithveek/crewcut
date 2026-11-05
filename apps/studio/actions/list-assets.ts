import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { searchAssets, toAssetDtos } from "../server/lib/assets.js";
import { pageArgs } from "../server/lib/search.js";
import { loadVideo } from "../server/lib/store.js";

export default defineAction({
  description:
    "Search media the person can use, newest first, one page at a time: a video's uploads, that video's uploads plus their library (video_and_library), their library, or everything they can see. Each asset has an id to reference as `asset:<id>` in image/video layers and audio clips. Returns total and per-type counts; page with offset.",
  schema: z.object({
    videoId: z.string().optional().describe("The video for scope video or video_and_library"),
    scope: z.enum(["video", "video_and_library", "library", "all"]).default("all"),
    mediaType: z.enum(["image", "video", "audio", "visual"]).optional().describe("visual = images and videos"),
    query: z.string().max(200).optional().describe("Search asset names"),
    limit: z.coerce.number().int().optional().describe("Page size, default 60, max 500"),
    offset: z.coerce.number().int().optional().describe("Rows to skip (offset of the page)"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ videoId, scope, mediaType, query, limit, offset }, ctx) => {
    if (videoId) await loadVideo(videoId, ctx);
    const page = pageArgs(limit, offset, { limit: 60, max: 500 });
    const { rows, total, counts } = await searchAssets(ctx, { scope, ...(videoId ? { videoId } : {}), ...(query ? { query } : {}), ...(mediaType ? { mediaType } : {}), ...page });
    const next = page.offset + rows.length;
    return { assets: await toAssetDtos(rows), total, counts, offset: page.offset, limit: page.limit, nextOffset: next < total ? next : null };
  },
});
