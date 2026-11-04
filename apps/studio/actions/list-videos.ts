import { defineAction } from "@agent-native/core/action";
import { stageStatesSchema } from "@proofcut/contracts";
import { pipelineProgress } from "@proofcut/pipeline";
import { z } from "zod";

import { parseJson } from "../server/lib/json.js";
import { listProjects, listVideos } from "../server/lib/store.js";

export default defineAction({
  description: "List the person's videos with their pipeline progress and the stages waiting on a person.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const [videos, projects] = await Promise.all([listVideos(ctx), listProjects(ctx)]);
    return {
      projects: projects.map((project) => ({ id: project.id, name: project.name, isDemo: project.isDemo })),
      videos: videos.map((video) => {
        const stages = parseJson(stageStatesSchema, video.stages, stageStatesSchema.parse({}));
        return {
          id: video.id,
          title: video.title,
          ratio: video.ratio,
          status: video.status,
          isDemo: video.isDemo,
          projectId: video.projectId,
          updatedAt: video.updatedAt,
          progress: pipelineProgress(stages),
        };
      }),
    };
  },
});
