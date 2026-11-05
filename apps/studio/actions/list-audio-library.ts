import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { AUDIO_LIBRARY, ensureLibraryFile, libraryFileName } from "../server/lib/audio-library.js";
import { resolveFileUrls } from "../server/lib/blob-store.js";

export default defineAction({
  description:
    "List Crewcut's built-in royalty-free audio: music beds and sound effects (whoosh, pop, ding, impact, riser…). Add one to a video with add-library-asset, then place it with edit-composition add-media-clip.",
  schema: z.object({ kind: z.enum(["music", "sfx"]).optional() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ kind }) => {
    const items = AUDIO_LIBRARY.filter((item) => !kind || item.kind === kind);
    await Promise.all(items.map((item) => ensureLibraryFile(item)));
    const urls = await resolveFileUrls("assets", items.map((item) => libraryFileName(item.id)));
    return {
      items: items.map((item) => ({
        id: item.id,
        label: item.label,
        kind: item.kind,
        mood: item.mood,
        bpm: item.bpm ?? null,
        durationMs: item.durationMs,
        url: urls.get(libraryFileName(item.id)) ?? "",
      })),
    };
  },
});
