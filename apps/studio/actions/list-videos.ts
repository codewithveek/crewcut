import { defineAction } from "@agent-native/core/action";
import type { Composition } from "@crewcut/composition";
import { stageStatesSchema } from "@crewcut/contracts";
import { pipelineProgress } from "@crewcut/pipeline";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseJson } from "../server/lib/json.js";
import { referencedAssetIds } from "../server/lib/render-runner.js";
import { resolveFileUrls } from "../server/lib/blob-store.js";
import { pageArgs } from "../server/lib/search.js";
import { latestComposition, listProjects, searchVideos } from "../server/lib/store.js";

/** GET args arrive as strings; accept real booleans too (agent and CLI calls). */
const flag = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .optional()
  .transform((value) => value === true || value === "true" || value === "1");

export default defineAction({
  description:
    "Search the person's videos, one page at a time, with their pipeline progress and the stages waiting on a person. query matches title and brief; filter: all, pipeline (agent-made), drafts (hand-made), published, waiting (needs the person's OK); sort: recent, created, title. Returns total and counts per filter; page with offset. withCompositions adds each latest composition (for thumbnails) and its duration.",
  schema: z.object({
    withCompositions: flag,
    query: z.string().max(200).optional(),
    filter: z.enum(["all", "pipeline", "drafts", "published", "waiting"]).default("all"),
    sort: z.enum(["recent", "created", "title"]).default("recent"),
    limit: z.coerce.number().int().optional().describe("Page size, default 24, max 100"),
    offset: z.coerce.number().int().optional().describe("Rows to skip"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ withCompositions, query, filter, sort, limit, offset }, ctx) => {
    const page = pageArgs(limit, offset, { limit: 24, max: 100 });
    const [{ rows: videos, total, counts }, projects] = await Promise.all([searchVideos(ctx, { ...(query ? { query } : {}), filter, sort, ...page }), listProjects(ctx)]);
    const latest = new Map<string, Composition>();
    if (withCompositions) {
      await Promise.all(
        videos
          .filter((video) => video.compositionVersion > 0)
          .map(async (video) => {
            const entry = await latestComposition(video.id);
            if (entry) latest.set(video.id, entry.composition);
          }),
      );
    }
    const assetIds = [...new Set([...latest.values()].flatMap(referencedAssetIds))];
    const assets = assetIds.length ? await getDb().select().from(schema.assets).where(inArray(schema.assets.id, assetIds)) : [];
    const urls = await resolveFileUrls("assets", assets.map((asset) => asset.fileName));
    const assetUrls = Object.fromEntries(assets.map((asset) => [asset.id, urls.get(asset.fileName) ?? ""]));
    return {
      projects: projects.map((project) => ({ id: project.id, name: project.name, isDemo: project.isDemo })),
      ...(withCompositions ? { assetUrls } : {}),
      total,
      counts,
      offset: page.offset,
      limit: page.limit,
      nextOffset: page.offset + videos.length < total ? page.offset + videos.length : null,
      videos: videos.map((video) => {
        const stages = parseJson(stageStatesSchema, video.stages, stageStatesSchema.parse({}));
        const composition = latest.get(video.id);
        return {
          id: video.id,
          title: video.title,
          ratio: video.ratio,
          status: video.status,
          isDemo: video.isDemo,
          projectId: video.projectId,
          createdAt: video.createdAt,
          updatedAt: video.updatedAt,
          hasComposition: video.compositionVersion > 0,
          /** "agents" videos started from a brief and run the pipeline; "manual" ones are blank projects. */
          mode: video.brief.trim() ? ("agents" as const) : ("manual" as const),
          progress: pipelineProgress(stages),
          ...(composition ? { durationMs: composition.durationMs, composition } : {}),
        };
      }),
    };
  },
});
