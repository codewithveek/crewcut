import { defineAction } from "@agent-native/core/action";
import { publishCopySchema, privacySchema } from "@crewcut/contracts";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireHuman } from "../server/lib/identity.js";
import { nowIso, toJson } from "../server/lib/json.js";
import { loadVideo, recordApproval, requireOwner, saveStages, updateVideo } from "../server/lib/store.js";
import { localCopy } from "../server/lib/blob-store.js";
import { fileVideoSource, youtubeClientFor, youtubeConnectionFor } from "../server/lib/youtube.js";
import { approveStage } from "@crewcut/pipeline";
import { runWithRequestContext } from "@agent-native/core/server";
import { UserError } from "../server/lib/errors.js";

/**
 * Publishing always needs a person: hidden from the agent, gated by approval,
 * and re-checked at run time. The upload runs in the background.
 */
export default defineAction({
  description: "Publish a prepared post (people only). Uploads the render to YouTube with the approved copy and privacy.",
  schema: z.object({ publishJobId: z.string(), privacy: privacySchema.optional() }),
  agentTool: false,
  uiOnly: true,
  toolCallable: false,
  needsApproval: true,
  run: async ({ publishJobId, privacy }, ctx) => {
    const who = requireHuman(ctx, "Publishing");
    const db = getDb();
    const [job] = await db.select().from(schema.publishJobs).where(eq(schema.publishJobs.id, publishJobId)).limit(1);
    if (!job) throw new UserError("No such post.");
    const video = await loadVideo(job.videoId, ctx, "editor");
    requireOwner(video, "Publishing to the channel");
    if (job.status !== "awaiting_approval" && job.status !== "failed") throw new UserError(`This post is ${job.status}.`);
    const connection = await youtubeConnectionFor(video.row.ownerEmail);
    if (!connection) throw new UserError("Connect YouTube in Settings → Connections first.");
    const [render] = await db.select().from(schema.renderJobs).where(eq(schema.renderJobs.id, job.renderJobId)).limit(1);
    if (!render?.outputFile) throw new UserError("The exported file for this post is missing. Export the video again.");

    const finalPrivacy = privacy ?? (job.privacy as "private" | "unlisted" | "public");
    // Everything that can refuse runs before the post is marked as uploading, so a refusal never strands it.
    const copy = publishCopySchema.parse(JSON.parse(job.copy));
    // Clicking Publish is the sign-off. Videos made in the editor never ran the earlier stages, so those don't hold it back.
    const approvedStages =
      video.stages.publish.status === "awaiting_approval" ? approveStage(video.stages, "publish", { now: nowIso(), actor: { kind: "human", id: who.email }, force: true }) : null;

    await db.update(schema.publishJobs).set({ status: "uploading", privacy: finalPrivacy, approvedBy: who.email, approvedAt: nowIso(), error: null }).where(eq(schema.publishJobs.id, job.id));
    try {
      await recordApproval(video, { stage: "publish", decision: "approved", subject: `${job.platform} (${finalPrivacy})`, actor: who });
      if (approvedStages) {
        video.stages = approvedStages;
        await saveStages(video.row.id, video.stages);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(schema.publishJobs).set({ status: "failed", error: message.slice(0, 2000) }).where(eq(schema.publishJobs.id, job.id));
      throw error;
    }
    // The upload outlives this request: re-establish the owner's context for its writes.
    const owner = { userEmail: video.row.ownerEmail, ...(video.row.orgId ? { orgId: video.row.orgId } : {}) };
    void runWithRequestContext(owner, async () => {
      try {
        const youtube = youtubeClientFor(connection);
        const source = await fileVideoSource(await localCopy("renders", render.outputFile as string));
        const result = await youtube.upload({
          video: source,
          copy,
          privacy: finalPrivacy,
          containsSyntheticMedia: true,
          shorts: job.platform === "youtube_shorts",
          ...(job.scheduledAt ? { publishAt: job.scheduledAt } : {}),
        });
        await db
          .update(schema.publishJobs)
          .set({ status: "published", platformPostId: result.videoId, url: result.url, warnings: toJson(result.warnings) })
          .where(eq(schema.publishJobs.id, job.id));
        await db.update(schema.connections).set({ lastUsedAt: nowIso(), status: "healthy" }).where(eq(schema.connections.id, connection.id));
        await updateVideo(video.row.id, { status: "published" });
        await recordApproval(video, { stage: "publish", decision: "published", subject: result.url, reason: result.warnings.join(" ") || `Uploaded as ${result.privacyStatus}`, actor: who });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.update(schema.publishJobs).set({ status: "failed", error: message.slice(0, 2000) }).where(eq(schema.publishJobs.id, job.id));
      }
    });
    return { publishJobId: job.id, status: "uploading", privacy: finalPrivacy };
  },
});
