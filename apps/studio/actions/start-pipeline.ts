import { defineAction } from "@agent-native/core/action";
import { aspectRatioSchema } from "@crewcut/composition";
import { platformSchema } from "@crewcut/contracts";
import { initialStageStates, startStage } from "@crewcut/pipeline";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { startAutopilot } from "../server/lib/autopilot.js";
import { requireAutopilot } from "../server/lib/plan-limits.js";
import { identity } from "../server/lib/identity.js";
import { UserError } from "../server/lib/errors.js";
import { nowIso, toJson } from "../server/lib/json.js";
import { ensureDefaultProject, ownership, requireProjectAccess } from "../server/lib/store.js";
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
    autopilot: z.boolean().default(false).describe("People only: the crew makes the whole video without stopping at the gates"),
  }),
  run: async (args, ctx) => {
    const who = identity(ctx);
    // Autopilot replaces the person's sign-offs, so only the person can switch it on.
    if (args.autopilot && who.kind !== "human") throw new UserError("Only the person can put a video on autopilot. Ask them to switch it on.", 403);
    if (args.autopilot) await requireAutopilot(who);
    const project = args.projectId ? await requireProjectAccess(args.projectId, ctx) : await ensureDefaultProject(who);
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
      ...(args.autopilot ? { autopilot: toJson(startAutopilot(who.email)) } : {}),
      ...ownership(who),
    });
    return { videoId: id, path: `/videos/${id}`, next: "Research the idea and call find-trends with ranked ideas and evidence." };
  },
});
