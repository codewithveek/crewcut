import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadVideo } from "../server/lib/store.js";
import { fileUrl, promoteToRemote } from "../server/lib/blob-store.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description: "A short-lived signed link (15 minutes) to a finished render, for preview or download.",
  schema: z.object({ videoId: z.string(), renderId: z.string(), download: z.boolean().default(true) }),
  readOnly: true,
  run: async ({ videoId, renderId, download }, ctx) => {
    await loadVideo(videoId, ctx);
    const [render] = await getDb()
      .select()
      .from(schema.renderJobs)
      .where(and(eq(schema.renderJobs.id, renderId), eq(schema.renderJobs.videoId, videoId)))
      .limit(1);
    if (!render?.outputFile || render.status !== "done") throw new UserError("That export isn't finished yet.");
    await promoteToRemote("renders", render.outputFile, "video/mp4", render.ownerEmail).catch(() => undefined);
    const url = await fileUrl("renders", render.outputFile);
    const local = url.startsWith("/api/media/");
    return { url: download && local ? `${url}&download=1` : url, expiresInSeconds: local ? 900 : null };
  },
});
