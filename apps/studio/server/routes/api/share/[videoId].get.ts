import { runWithRequestContext } from "@agent-native/core/server";
import { and, desc, eq } from "drizzle-orm";
import { defineEventHandler, getRouterParam } from "h3";

import { getDb, schema } from "../../../db/index.js";
import { fileUrl, promoteToRemote } from "../../../lib/blob-store.js";

/**
 * The view-only page's data (/watch/<videoId>), readable without signing in.
 * Only for videos their owner set to "Anyone with the link"; anything else is
 * a plain 404, so a private video's existence isn't revealed. Returns the
 * title and the latest finished export, never the owner or the edit.
 */
export default defineEventHandler(async (event) => {
  const videoId = getRouterParam(event, "videoId") ?? "";
  const notFound = () => new Response(JSON.stringify({ error: "not-found" }), { status: 404, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(videoId)) return notFound();
  const db = getDb();
  const [video] = await db
    .select({ id: schema.videos.id, title: schema.videos.title, ratio: schema.videos.ratio, visibility: schema.videos.visibility, ownerEmail: schema.videos.ownerEmail, orgId: schema.videos.orgId })
    .from(schema.videos)
    .where(eq(schema.videos.id, videoId))
    .limit(1);
  if (!video || video.visibility !== "public") return notFound();
  const [render] = await db
    .select()
    .from(schema.renderJobs)
    .where(and(eq(schema.renderJobs.videoId, videoId), eq(schema.renderJobs.status, "done")))
    .orderBy(desc(schema.renderJobs.createdAt))
    .limit(1);
  let videoUrl: string | null = null;
  if (render?.outputFile) {
    const file = render.outputFile;
    // Storage lookups run as the owner, like the render that made the file.
    videoUrl = await runWithRequestContext({ userEmail: video.ownerEmail, ...(video.orgId ? { orgId: video.orgId } : {}) }, async () => {
      await promoteToRemote("renders", file, "video/mp4", video.ownerEmail).catch(() => undefined);
      return fileUrl("renders", file);
    });
  }
  return new Response(JSON.stringify({ id: video.id, title: video.title, ratio: render?.ratio ?? video.ratio, videoUrl, exportedAt: render?.createdAt ?? null }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
});
