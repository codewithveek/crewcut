import { defineAction } from "@agent-native/core/action";
import {
  VIDEO_PRESETS,
  type ArtDirectionBrief,
  aspectRatioSchema,
  artDirectionBriefSchema,
  composeSceneSchema,
  composeVideo,
  generateArtDirectionBrief,
  lintMotion,
} from "@crewcut/composition";
import { applyNarration, composeFromScript } from "@crewcut/pipeline";
import { z } from "zod";

import { beginStage, finishStage, summarizeComposition } from "../server/lib/pipeline-ops.js";
import { getProject, latestComposition, latestScript, loadDossier, loadVideo, recentFingerprints, saveComposition } from "../server/lib/store.js";
import { lineAudioFor } from "../server/lib/voice-ops.js";

export default defineAction({
  description: `Motion director: compose the video as freeform layers. First write an art direction brief (mood, palette, type pairing, layout grid, motion signature, transition set, pacing) — fresh for every video unless the person asked for a preset or consistency. Then give one scene per beat: freeform \`layers\` (text, shape, image, video, code, chart, icon, group, camera with keyframes), and/or a \`recipe\` as a starting point. Motion rules: springs first (critically damped, response 0.35–0.5 s); enter from scale 0.9–0.95 with opacity, never 0; ease-out for entrances, ease-in-out for moves; stagger 40–80 ms; blur ≤ 20 px; video entrances 400–700 ms. Omit scenes to get a deterministic first draft from the script that you can then edit.`,
  schema: z.object({
    videoId: z.string(),
    brief: artDirectionBriefSchema.optional(),
    preset: z.enum(["editorial", "studio", "graphic", "cinematic"]).optional().describe("Only when the person asked for a preset"),
    scenes: z.array(composeSceneSchema).max(24).optional(),
    ratio: aspectRatioSchema.optional(),
    label: z.string().max(80).default("Compose video"),
  }),
  run: async (args, ctx) => {
    const video = await loadVideo(args.videoId, ctx, "editor");
    await beginStage(video, "motion");
    const scriptEntry = await latestScript(args.videoId);
    if (!scriptEntry) throw new Error("Write the script before composing.");
    const [dossier, previous, recent, project] = await Promise.all([
      loadDossier(args.videoId),
      latestComposition(args.videoId),
      recentFingerprints(video.row.projectId, args.videoId),
      getProject(video.row.projectId),
    ]);
    const ratio = args.ratio ?? (video.row.ratio as "16:9");
    const brief: ArtDirectionBrief =
      args.brief ??
      (args.preset ? VIDEO_PRESETS[args.preset]?.brief : undefined) ??
      generateArtDirectionBrief({ seed: video.row.seed, avoid: video.row.consistencyRequested ? [] : recent.map((entry) => entry.fingerprint), candidates: 10 });
    const lineAudio = lineAudioFor(scriptEntry.script, previous?.composition ?? null);

    const composition = args.scenes
      ? applyNarration(
          composeVideo({
            id: args.videoId,
            title: scriptEntry.script.headline,
            ratio,
            seed: video.row.seed,
            brief,
            scenes: args.scenes.map((scene, index) => ({
              ...scene,
              id: scene.id ?? `scene-${index + 1}`,
              transition: scene.transition === null ? null : scene.transition,
            })) as Parameters<typeof composeVideo>[0]["scenes"],
          }),
          lineAudio,
        )
      : composeFromScript({ videoId: args.videoId, script: scriptEntry.script, dossier, ratio, seed: video.row.seed, brief, lineAudio });

    const version = await saveComposition(video, composition, args.label);
    const findings = lintMotion(composition);
    const status = await finishStage(video, "motion", { note: `Composition v${version}: ${composition.brief.mood}` });
    return {
      version,
      status,
      brief: composition.brief,
      summary: summarizeComposition(composition),
      motionFindings: findings.slice(0, 10),
      varietyNote: recent.length ? `Compared against ${recent.length} recent videos; run check-sameness for the score.` : "First video in this workspace.",
      threshold: project?.varietyThreshold,
    };
  },
});
