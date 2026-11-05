import { defineAction } from "@agent-native/core/action";
import { FRAME_SIZE, aspectRatioSchema, createEmptyComposition, generateArtDirectionBrief } from "@crewcut/composition";
import { initialStageStates } from "@crewcut/pipeline";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { identity } from "../server/lib/identity.js";
import { toJson } from "../server/lib/json.js";
import { newId } from "../server/lib/storage.js";
import { ensureDefaultProject, loadVideo, ownership, recentFingerprints, saveComposition } from "../server/lib/store.js";

export default defineAction({
  description:
    "Create an empty project the person edits by hand in the editor (no agent pipeline): a video with a blank composition in the chosen aspect ratio. Returns the editor path.",
  schema: z.object({
    title: z.string().trim().min(1).max(120).default("Untitled project"),
    ratio: aspectRatioSchema.default("16:9"),
    projectId: z.string().optional(),
  }),
  run: async ({ title, ratio, projectId }, ctx) => {
    const who = identity(ctx);
    const project = projectId ? { id: projectId } : await ensureDefaultProject(who);
    const id = newId("vid");
    const seed = Math.floor(Math.random() * 1_000_000) + 1;
    const portrait = FRAME_SIZE[ratio].height > FRAME_SIZE[ratio].width;
    await getDb()
      .insert(schema.videos)
      .values({
        id,
        projectId: project.id,
        title,
        brief: "",
        ratio,
        platforms: toJson([portrait ? "youtube_shorts" : "youtube"]),
        stages: toJson(initialStageStates()),
        seed,
        ...ownership(who),
      });
    const video = await loadVideo(id, ctx, "editor");
    const avoid = (await recentFingerprints(project.id, id)).map((entry) => entry.fingerprint);
    const brief = generateArtDirectionBrief({ seed, avoid });
    const composition = createEmptyComposition({ id, title, ratio, brief, seed });
    const version = await saveComposition(video, composition, "Blank project");
    return { videoId: id, version, path: `/videos/${id}/edit` };
  },
});
