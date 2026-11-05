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
import { latestComposition, listProjects, listVideos } from "../server/lib/store.js";

/** GET args arrive as strings; accept real booleans too (agent and CLI calls). */
const flag = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .optional()
  .transform((value) => value === true || value === "true" || value === "1");

export default defineAction({
  description: "List the person's videos with their pipeline progress and the stages waiting on a person. withCompositions adds each latest composition (for thumbnails) and its duration.",
  schema: z.object({ withCompositions: flag }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ withCompositions }, ctx) => {
    const [videos, projects] = await Promise.all([listVideos(ctx), listProjects(ctx)]);
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
