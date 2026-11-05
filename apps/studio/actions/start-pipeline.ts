import { defineAction } from "@agent-native/core/action";
import { aspectRatioSchema } from "@crewcut/composition";
import { platformSchema } from "@crewcut/contracts";
import { initialStageStates, startStage } from "@crewcut/pipeline";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { identity } from "../server/lib/identity.js";
import { nowIso, toJson } from "../server/lib/json.js";
import { ensureDefaultProject, ownership } from "../server/lib/store.js";
import { newId } from "../server/lib/storage.js";

export default defineAction({
  description:
    "Start a new video from an idea or topic. Creates the video and puts the trend stage to work. After this, research ideas (or use the person's idea) and call find-trends with 3–5 ranked ideas.",
  schema: z.object({
    brief: z.string().min(3).max(2000).describe("The person's idea, topic, URL or notes"),
    title: z.string().min(1).max(120).optional(),
    ratio: aspectRatioSchema.default("16:9"),
    platforms: z.array(platformSchema).min(1).default(["youtube"]),
    projectId: z.string().optional(),
  }),
  run: async (args, ctx) => {
    const who = identity(ctx);
    const project = args.projectId ? { id: args.projectId } : await ensureDefaultProject(who);
    const id = newId("vid");
    const stages = startStage(initialStageStates(), "trend", { now: nowIso(), actor: { kind: who.kind === "human" ? "human" : "agent", id: who.actorId } });
    await getDb().insert(schema.videos).values({
      id,
      projectId: project.id,
      title: args.title ?? args.brief.slice(0, 80),
      brief: args.brief,
      ratio: args.ratio,
      platforms: toJson(args.platforms),
      stages: toJson(stages),
      seed: Math.floor(Math.random() * 1_000_000) + 1,
      ...ownership(who),
    });
    return { videoId: id, path: `/videos/${id}`, next: "Research the idea and call find-trends with ranked ideas and evidence." };
  },
});
