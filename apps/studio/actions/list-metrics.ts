import { defineAction } from "@agent-native/core/action";
import { metricsSchema } from "@proofcut/contracts";
import { desc, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseJson } from "../server/lib/json.js";
import { listVideos } from "../server/lib/store.js";

/** Read-only and extension-callable, so mini-apps can chart retention across videos. */
export default defineAction({
  description:
    "List metrics for the person's videos: latest snapshot per video and window, with retention curves (at 0..1, ratio). Built for dashboards and mini-apps, e.g. comparing retention across the last five videos.",
  schema: z.object({ limit: z.number().int().min(1).max(50).default(10), window: z.enum(["48h", "7d", "28d"]).optional() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ limit, window }, ctx) => {
    const videos = (await listVideos(ctx)).slice(0, limit);
    if (videos.length === 0) return { videos: [] };
    const snapshots = await getDb()
      .select()
      .from(schema.metricSnapshots)
      .where(inArray(schema.metricSnapshots.videoId, videos.map((video) => video.id)))
      .orderBy(desc(schema.metricSnapshots.capturedAt));
    return {
      videos: videos
        .map((video) => {
          const latest = snapshots.find((snapshot) => snapshot.videoId === video.id && (!window || snapshot.window === window));
          if (!latest) return null;
          const metrics = parseJson(metricsSchema, latest.metrics, metricsSchema.parse({ views: 0 }));
          return {
            id: video.id,
            title: video.title,
            window: latest.window,
            source: latest.source,
            views: metrics.views,
            ctr: metrics.ctr,
            averagePercentViewed: metrics.averagePercentViewed,
            averageViewDurationSec: metrics.averageViewDurationSec,
            subscribersGained: metrics.subscribersGained,
            retention: metrics.retention,
          };
        })
        .filter((entry) => entry !== null),
    };
  },
});
