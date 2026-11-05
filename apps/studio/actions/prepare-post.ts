import { defineAction } from "@agent-native/core/action";
import { PLATFORM_SPECS, platformSchema, privacySchema, publishCopySchema } from "@crewcut/contracts";
import { adaptCopy, validateForYouTube } from "@crewcut/distribute";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { toJson } from "../server/lib/json.js";
import { beginStage, finishStage } from "../server/lib/pipeline-ops.js";
import { loadDossier, loadVideo } from "../server/lib/store.js";
import { newId } from "../server/lib/storage.js";
import { youtubeConnectionFor } from "../server/lib/youtube.js";

export default defineAction({
  description:
    "Publish agent: prepare a post for a finished render — title, description, hashtags and keywords (sources from the dossier are appended automatically). Checks the platform's specs and quota notes before anything uploads. The post then waits for a person to click Publish; privacy defaults to private.",
  schema: z.object({
    videoId: z.string(),
    platform: platformSchema.default("youtube"),
    renderId: z.string().optional().describe("Defaults to the latest finished render"),
    copy: publishCopySchema,
    privacy: privacySchema.default("private"),
    scheduledAt: z.string().datetime().optional(),
  }),
  run: async (args, ctx) => {
    const video = await loadVideo(args.videoId, ctx, "editor");
    const spec = PLATFORM_SPECS[args.platform];
    if (!spec.supported) throw new Error(`${spec.label} publishing isn't wired in this build yet (${spec.auditNote}).`);
    const db = getDb();
    const [render] = await db
      .select()
      .from(schema.renderJobs)
      .where(and(eq(schema.renderJobs.videoId, args.videoId), args.renderId ? eq(schema.renderJobs.id, args.renderId) : eq(schema.renderJobs.status, "done")))
      .orderBy(desc(schema.renderJobs.createdAt))
      .limit(1);
    if (!render || render.status !== "done") throw new Error("Render the video first; publishing uses a finished render.");
    await beginStage(video, "publish");
    const dossier = await loadDossier(args.videoId);
    const sources = dossier?.sources.filter((source) => source.url).map((source) => ({ title: source.title, url: source.url as string })) ?? [];
    const copy = publishCopySchema.parse({ ...args.copy, sources: args.copy.sources.length ? args.copy.sources : sources.slice(0, 5) });
    const issues = validateForYouTube({
      video: { size: render.outputBytes ?? 0, mime: "video/mp4", read: async () => new Uint8Array() },
      shorts: args.platform === "youtube_shorts",
      copy,
    });
    const connection = await youtubeConnectionFor(video.row.ownerEmail);
    const id = newId("pub");
    await db.insert(schema.publishJobs).values({
      id,
      videoId: args.videoId,
      renderJobId: render.id,
      platform: args.platform,
      connectionId: connection?.id ?? null,
      copy: toJson(copy),
      privacy: args.privacy,
      scheduledAt: args.scheduledAt ?? null,
      status: "awaiting_approval",
      warnings: toJson(issues),
      ownerEmail: video.row.ownerEmail,
      orgId: video.row.orgId,
    });
    await finishStage(video, "publish", { note: `${spec.label} post ready (${args.privacy}) — waiting for a person to publish` });
    return {
      publishJobId: id,
      preview: adaptCopy(args.platform, copy),
      privacy: args.privacy,
      connected: Boolean(connection),
      issues,
      platformNotes: [spec.auditNote, spec.limitNote],
      next: connection ? "Ask the person to review and click Publish." : "Connect YouTube in Settings → Connections, then the person can publish.",
    };
  },
});
