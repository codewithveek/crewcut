import { defineAction } from "@agent-native/core/action";
import { VIDEO_PRESETS, type ArtDirectionBrief, type Composition, artDirectionBriefSchema, setArtDirection } from "@crewcut/composition";
import { composeFromScript } from "@crewcut/pipeline";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";
import { latestScript, loadDossier, loadVideo } from "../server/lib/store.js";
import { lineAudioFor } from "../server/lib/voice-ops.js";

export default defineAction({
  description:
    "Edit the art direction brief (mood, palette, type pairing, layout grid, motion signature, transitions, pacing) or switch to a preset look. With recompose, scenes are rebuilt from the script in the new direction as one undoable step (hand edits are replaced).",
  schema: z.object({
    videoId: z.string(),
    brief: artDirectionBriefSchema.partial().optional(),
    preset: z.enum(["editorial", "studio", "graphic", "cinematic"]).optional(),
    recompose: z.boolean().default(true),
  }),
  run: async ({ videoId, brief, preset, recompose }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const [scriptEntry, dossier] = await Promise.all([latestScript(videoId), loadDossier(videoId)]);
    const presetBrief = preset ? VIDEO_PRESETS[preset]?.brief : undefined;
    const nextBriefFor = (composition: Composition): ArtDirectionBrief =>
      artDirectionBriefSchema.parse({
        ...composition.brief,
        ...presetBrief,
        ...brief,
        palette: { ...composition.brief.palette, ...presetBrief?.palette, ...brief?.palette },
      });
    const label = preset ? `Apply ${VIDEO_PRESETS[preset]?.label ?? preset} look` : "Edit art direction";
    return runCompositionEdit(ctx, videoId, label, (composition) => {
      const nextBrief = nextBriefFor(composition);
      if (!recompose || !scriptEntry) return setArtDirection(composition, { brief: nextBrief });
      return composeFromScript({
        videoId,
        script: scriptEntry.script,
        dossier,
        ratio: composition.ratio,
        seed: video.row.seed,
        brief: nextBrief,
        lineAudio: lineAudioFor(scriptEntry.script, composition),
      });
    });
  },
});
