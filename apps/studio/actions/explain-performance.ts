import { defineAction } from "@agent-native/core/action";
import { explainPerformance, learningsFromInsights } from "@crewcut/analytics";
import { metricWindowSchema, metricsSchema } from "@crewcut/contracts";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJsonStrict, toJson } from "../server/lib/json.js";
import { finishStage } from "../server/lib/pipeline-ops.js";
import { compositionAt, latestComposition, loadVideo } from "../server/lib/store.js";
import { newId } from "../server/lib/storage.js";

export default defineAction({
  description:
    "Analytics agent: explain why a video worked or didn't. Maps retention drops to the exact scene and line, grounds CTR in the channel baseline, groups comments into questions/objections/requests, and turns that into learnings the next script and motion agents read. Publish-time advice is labelled low impact.",
  schema: z.object({ videoId: z.string(), window: metricWindowSchema.default("7d"), saveLearnings: z.boolean().default(true) }),
  run: async ({ videoId, window, saveLearnings }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const db = getDb();
    const [snapshot] = await db
      .select()
      .from(schema.metricSnapshots)
      .where(and(eq(schema.metricSnapshots.videoId, videoId), eq(schema.metricSnapshots.window, window)))
      .orderBy(desc(schema.metricSnapshots.capturedAt))
      .limit(1);
    if (!snapshot) throw new Error(`Pull ${window} metrics first.`);
    const metrics = parseJsonStrict(metricsSchema, snapshot.metrics, "metrics");
    // Explain against what was actually published: the render's composition version.
    const [post] = await db.select().from(schema.publishJobs).where(eq(schema.publishJobs.videoId, videoId)).orderBy(desc(schema.publishJobs.createdAt)).limit(1);
    const [render] = post ? await db.select().from(schema.renderJobs).where(eq(schema.renderJobs.id, post.renderJobId)).limit(1) : [];
    const composition = (render ? await compositionAt(videoId, render.compositionVersion) : null) ?? (await latestComposition(videoId))?.composition;
    if (!composition) throw new Error("No composition to map the results onto.");

    const insights = explainPerformance({ videoId, composition, metrics, window });
    await db.delete(schema.insights).where(and(eq(schema.insights.videoId, videoId), eq(schema.insights.window, window)));
    for (const insight of insights) {
      await db.insert(schema.insights).values({ id: newId("ins"), videoId, window, body: toJson(insight), ownerEmail: video.row.ownerEmail, orgId: video.row.orgId });
    }
    const learnings = learningsFromInsights(insights, nowIso());
    if (saveLearnings) {
      for (const learning of learnings) {
        await db.insert(schema.learnings).values({
          id: newId("lrn"),
          projectId: video.row.projectId,
          scope: learning.scope,
          text: learning.text,
          evidence: learning.evidence,
          ownerEmail: video.row.ownerEmail,
          orgId: video.row.orgId,
        });
      }
    }
    await finishStage(video, "analytics", { note: `${insights.length} insights from ${window} (${snapshot.source})` });
    return { window, source: snapshot.source, insights, learnings: learnings.map((learning) => learning.text) };
  },
});
