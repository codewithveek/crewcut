import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { AUDIO_LIBRARY, ensureLibraryFile, libraryFileName } from "../server/lib/audio-library.js";
import { resolveFileUrls } from "../server/lib/blob-store.js";
import { visibleItems } from "../server/lib/catalog.js";
import { identity } from "../server/lib/identity.js";

export default defineAction({
  description:
    "List Crewcut's royalty-free audio: music beds and sound effects (whoosh, pop, ding, impact, riser…), including tracks and sounds published in the catalog (ids starting cat:, with a pack and tier). Add one to a video with add-library-asset, then place it with edit-composition add-media-clip. Pro items (tier \"pro\") can be used and edited, but exporting them needs Crewcut Pro: say so before choosing one.",
  schema: z.object({ kind: z.enum(["music", "sfx"]).optional() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ kind }, ctx) => {
    const who = identity(ctx);
    const items = AUDIO_LIBRARY.filter((item) => !kind || item.kind === kind);
    await Promise.all(items.map((item) => ensureLibraryFile(item)));
    // Published catalog music and sounds come first: they're the real tracks; the built-in tones follow.
    const catalog = (await visibleItems(who, kind === "music" ? ["music"] : kind === "sfx" ? ["sound"] : ["music", "sound"])).flatMap((entry) => (entry.payload.type === "audio" ? [{ entry, payload: entry.payload }] : []));
    const urls = await resolveFileUrls("assets", [...items.map((item) => libraryFileName(item.id)), ...catalog.map(({ payload }) => payload.media.fileName)]);
    return {
      items: [
        ...catalog.map(({ entry, payload }) => ({
          id: `cat:${entry.item.id}`,
          label: entry.item.name,
          kind: entry.item.kind === "sound" ? ("sfx" as const) : ("music" as const),
          mood: payload.mood || entry.pack?.name || "",
          bpm: payload.bpm,
          durationMs: payload.media.durationMs ?? 0,
          url: urls.get(payload.media.fileName) ?? "",
          tier: entry.tier,
          packName: entry.pack?.name ?? null,
        })),
        ...items.map((item) => ({
          id: item.id,
          label: item.label,
          kind: item.kind,
          mood: item.mood,
          bpm: item.bpm ?? null,
          durationMs: item.durationMs,
          url: urls.get(libraryFileName(item.id)) ?? "",
          tier: "free" as const,
          packName: null,
        })),
      ],
    };
  },
});
