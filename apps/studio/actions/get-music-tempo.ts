import { defineAction } from "@agent-native/core/action";
import { getTemplate } from "@crewcut/composition";
import { z } from "zod";

import { findVisibleAsset } from "../server/lib/assets.js";
import { AUDIO_LIBRARY } from "../server/lib/audio-library.js";
import { UserError } from "../server/lib/errors.js";
import { parseJsonLoose } from "../server/lib/json.js";
import { loadVideo } from "../server/lib/store.js";

/**
 * The known tempo of a video's music, from where the track came from: a
 * template's soundtrack (made at the template's tempo), a library track, or
 * a catalog track an admin gave a BPM. Null when it isn't known (an upload):
 * the editor then measures it from the audio.
 */
export default defineAction({
  description: "The tempo (BPM) of a music asset in a video when its source says so (template, library or catalog track); null for uploads. Used by beat sync.",
  schema: z.object({ videoId: z.string(), assetId: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ videoId, assetId }, ctx) => {
    await loadVideo(videoId, ctx);
    const row = await findVisibleAsset(ctx, assetId);
    if (!row) throw new UserError("That music isn't available.");
    const provenance = parseJsonLoose<{ bpm?: number; template?: string; provider?: string; itemId?: string }>(row.provenance, {});
    if (typeof provenance.bpm === "number" && provenance.bpm > 0) return { bpm: provenance.bpm, source: "catalog" as const };
    const template = provenance.template ? getTemplate(provenance.template) : null;
    if (template) return { bpm: template.bpm, source: "template" as const };
    if (provenance.provider === "crewcut-library" && provenance.itemId) {
      const item = AUDIO_LIBRARY.find((candidate) => candidate.id === provenance.itemId);
      if (item?.bpm) return { bpm: item.bpm, source: "library" as const };
    }
    return { bpm: null, source: null };
  },
});
