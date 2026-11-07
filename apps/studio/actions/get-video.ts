import { defineAction } from "@agent-native/core/action";
import { DEFAULT_EXPORT_RESOLUTION, type ExportResolution, exportSize } from "@crewcut/composition";
import { STAGE_LABELS } from "@crewcut/contracts";
import { pipelineProgress } from "@crewcut/pipeline";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseJsonLoose } from "../server/lib/json.js";
import { summarizeComposition } from "../server/lib/pipeline-ops.js";
import {
  latestAudit,
  latestComposition,
  latestQa,
  latestScript,
  listApprovals,
  listSources,
  loadDossier,
  loadVideo,
} from "../server/lib/store.js";

export default defineAction({
  description:
    "Read everything about a video: pipeline stages and gates, ideas, dossier, script, claim audit, QA, composition summary, renders, publish jobs and the approval log. Read this before acting on a video.",
  schema: z.object({
    videoId: z.string(),
    include: z.array(z.enum(["dossier", "script", "audit", "qa", "composition", "sources", "renders", "publish", "approvals", "insights"])).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ videoId, include }, ctx) => {
    const video = await loadVideo(videoId, ctx);
    const want = (part: string) => !include || include.includes(part as never);
    const db = getDb();
    const [dossier, scriptEntry, audit, qa, compositionEntry, sources, renders, publishes, approvals, insights] = await Promise.all([
      want("dossier") ? loadDossier(videoId) : null,
      want("script") ? latestScript(videoId) : null,
      want("audit") ? latestAudit(videoId) : null,
      want("qa") ? latestQa(videoId) : null,
      want("composition") ? latestComposition(videoId) : null,
      want("sources") ? listSources(videoId) : [],
      want("renders") ? db.select().from(schema.renderJobs).where(eq(schema.renderJobs.videoId, videoId)).orderBy(desc(schema.renderJobs.createdAt)).limit(10) : [],
      want("publish") ? db.select().from(schema.publishJobs).where(eq(schema.publishJobs.videoId, videoId)).orderBy(desc(schema.publishJobs.createdAt)) : [],
      want("approvals") ? listApprovals(videoId) : [],
      want("insights") ? db.select().from(schema.insights).where(eq(schema.insights.videoId, videoId)).orderBy(desc(schema.insights.createdAt)).limit(20) : [],
    ]);
    return {
      video: {
        id: video.row.id,
        title: video.row.title,
        brief: video.row.brief,
        ratio: video.row.ratio,
        platforms: video.platforms,
        status: video.row.status,
        isDemo: video.row.isDemo,
        projectId: video.row.projectId,
        pickedIdeaId: video.row.pickedIdeaId,
        scriptVersion: video.row.scriptVersion,
        compositionVersion: video.row.compositionVersion,
        updatedAt: video.row.updatedAt,
      },
      stages: video.stages,
      stageLabels: STAGE_LABELS,
      progress: pipelineProgress(video.stages),
      ideas: video.ideas,
      dossier,
      script: scriptEntry,
      audit,
      qa,
      composition: compositionEntry ? { version: compositionEntry.version, label: compositionEntry.label, summary: summarizeComposition(compositionEntry.composition) } : null,
      sources: sources.map((source) => ({ id: source.id, kind: source.kind, title: source.title, url: source.url, publisher: source.publisher, length: source.content.length, retrievedAt: source.retrievedAt, redactions: source.redactions })),
      renders: renders.map((render) => ({ id: render.id, status: render.status, progress: render.progress, stage: render.stage, ratio: render.ratio, ...renderSize(render.payload), compositionVersion: render.compositionVersion, outputFile: render.outputFile, outputBytes: render.outputBytes, error: render.error, createdAt: render.createdAt })),
      publishJobs: publishes.map((job) => ({ ...job, copy: JSON.parse(job.copy) as unknown, warnings: JSON.parse(job.warnings) as string[] })),
      approvals,
      insights: insights.map((row) => ({ window: row.window, ...(JSON.parse(row.body) as Record<string, unknown>) })),
    };
  },
});

/** The resolution and pixel size an export was made at (exports from before resolutions existed are the project's own size). */
function renderSize(payload: string): { resolution: ExportResolution; width: number | null; height: number | null } {
  const job = parseJsonLoose<{ composition?: { width?: number; height?: number }; options?: { resolution?: ExportResolution } }>(payload, {});
  const resolution = job.options?.resolution ?? DEFAULT_EXPORT_RESOLUTION;
  const width = job.composition?.width;
  const height = job.composition?.height;
  if (!width || !height) return { resolution, width: null, height: null };
  return { resolution, ...(job.options?.resolution ? exportSize(width, height, resolution) : { width, height }) };
}
