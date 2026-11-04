import { defineAction } from "@agent-native/core/action";
import { metricWindowSchema } from "@proofcut/contracts";
import { demoMetrics } from "@proofcut/pipeline";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { toJson } from "../server/lib/json.js";
import { loadVideo } from "../server/lib/store.js";
import { newId } from "../server/lib/storage.js";
import { youtubeClientFor, youtubeConnectionFor } from "../server/lib/youtube.js";

const WINDOW_DAYS = { "48h": 2, "7d": 7, "28d": 28 } as const;

export default defineAction({
  description:
    "Analytics agent: read a published video's results for a window (48h, 7d, 28d) from the YouTube Analytics API — views, CTR, average view duration, retention curve, subscribers, comments. Sample videos use their seeded data.",
  schema: z.object({ videoId: z.string(), window: metricWindowSchema.default("7d") }),
  run: async ({ videoId, window }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const db = getDb();
    let source: "youtube" | "sample";
    let metrics;
    if (video.row.status === "sample") {
      source = "sample";
      metrics = demoMetrics()[window];
    } else {
      const [post] = await db
        .select()
        .from(schema.publishJobs)
        .where(and(eq(schema.publishJobs.videoId, videoId), eq(schema.publishJobs.status, "published")))
        .orderBy(desc(schema.publishJobs.createdAt))
        .limit(1);
      if (!post?.platformPostId) throw new Error("This video hasn't been published yet.");
      const connection = await youtubeConnectionFor(video.row.ownerEmail);
      if (!connection) throw new Error("Reconnect YouTube to read analytics.");
      const published = new Date(post.approvedAt ?? post.createdAt);
      const end = new Date(Math.min(Date.now(), published.getTime() + WINDOW_DAYS[window] * 86_400_000));
      metrics = await youtubeClientFor(connection).metrics(post.platformPostId, {
        startDate: published.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
      });
      source = "youtube";
    }
    await db.insert(schema.metricSnapshots).values({
      id: newId("met"),
      videoId,
      window,
      metrics: toJson(metrics),
      source,
      ownerEmail: video.row.ownerEmail,
      orgId: video.row.orgId,
    });
    return { window, source, views: metrics.views, ctr: metrics.ctr, averagePercentViewed: metrics.averagePercentViewed, retentionPoints: metrics.retention.length, comments: metrics.comments.length };
  },
});
