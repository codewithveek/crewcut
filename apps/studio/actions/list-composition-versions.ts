import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { pageArgs } from "../server/lib/search.js";
import { listCompositionVersions, loadVideo } from "../server/lib/store.js";

export default defineAction({
  description: "List a video's edit history (composition versions), newest first, one page at a time. get-composition already includes the latest 50; use offset to go further back.",
  schema: z.object({
    videoId: z.string(),
    limit: z.coerce.number().int().optional().describe("Page size, default 50, max 200"),
    offset: z.coerce.number().int().optional().describe("Versions to skip from the newest"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ videoId, limit, offset }, ctx) => {
    await loadVideo(videoId, ctx);
    const page = pageArgs(limit, offset, { limit: 50, max: 200 });
    const versions = await listCompositionVersions(videoId, page.limit + 1, page.offset);
    return { versions: versions.slice(0, page.limit), hasMore: versions.length > page.limit };
  },
});
