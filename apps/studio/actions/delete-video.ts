
import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { deleteAssetFile } from "../server/lib/assets.js";
import { requireHuman } from "../server/lib/identity.js";
import { removeFile } from "../server/lib/blob-store.js";
import { loadVideo } from "../server/lib/store.js";

/**
 * People-only: hidden from the agent, MCP and A2A, and re-checked at run
 * time. Deletes the video, every version, report and job that belongs to it,
 * its uploads and its rendered files.
 */
export default defineAction({
  description: "Delete a video (project) and everything that belongs to it (people only).",
  schema: z.object({ videoId: z.string() }),
  agentTool: false,
  uiOnly: true,
  toolCallable: false,
  run: async ({ videoId }, ctx) => {
    requireHuman(ctx, "Deleting a video");
    const video = await loadVideo(videoId, ctx, "editor");
    const db = getDb();
    const [assets, renders] = await Promise.all([
      db.select().from(schema.assets).where(eq(schema.assets.videoId, videoId)),
      db.select().from(schema.renderJobs).where(eq(schema.renderJobs.videoId, videoId)),
    ]);
    const byVideo = [
      schema.sources,
      schema.scripts,
      schema.claimAudits,
      schema.qaReports,
      schema.compositions,
      schema.assets,
      schema.renderJobs,
      schema.publishJobs,
      schema.metricSnapshots,
      schema.insights,
      schema.approvalEvents,
    ] as const;
    for (const table of byVideo) await db.delete(table).where(eq(table.videoId, videoId));
    await db.delete(schema.dossiers).where(eq(schema.dossiers.videoId, videoId));
    await db.delete(schema.videoShares).where(eq(schema.videoShares.resourceId, videoId));
    await db.delete(schema.videos).where(eq(schema.videos.id, videoId));
    for (const asset of assets) await deleteAssetFile(asset);
    for (const render of renders) {
      if (!render.outputFile) continue;
      await removeFile("renders", render.outputFile);
    }
    return { deleted: videoId, title: video.row.title };
  },
});
