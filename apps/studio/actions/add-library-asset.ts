import { defineAction } from "@agent-native/core/action";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { AUDIO_LIBRARY, ensureLibraryFile, libraryFileName } from "../server/lib/audio-library.js";
import { identity } from "../server/lib/identity.js";
import { toJson } from "../server/lib/json.js";
import { loadVideo } from "../server/lib/store.js";
import { fileUrl } from "../server/lib/blob-store.js";
import { newId } from "../server/lib/storage.js";

export default defineAction({
  description:
    "Make a built-in library sound (from list-audio-library) available as an asset for a video (or the person's library). Returns the assetId to use with add-media-clip. Reuses the existing asset if it was added before.",
  schema: z.object({ itemId: z.string(), videoId: z.string().optional() }),
  run: async ({ itemId, videoId }, ctx) => {
    const item = AUDIO_LIBRARY.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`No library item "${itemId}"`);
    const who = identity(ctx);
    const video = videoId ? await loadVideo(videoId, ctx, "editor") : null;
    const fileName = libraryFileName(item.id);
    const bytes = await ensureLibraryFile(item);
    const db = getDb();
    const scope = videoId ? eq(schema.assets.videoId, videoId) : and(isNull(schema.assets.videoId), eq(schema.assets.ownerEmail, who.email));
    const [existing] = await db.select().from(schema.assets).where(and(scope, eq(schema.assets.fileName, fileName))).limit(1);
    const id = existing?.id ?? newId("ast");
    if (!existing) {
      await db.insert(schema.assets).values({
        id,
        videoId: videoId ?? null,
        kind: item.kind,
        label: item.label,
        fileName,
        mime: "audio/wav",
        bytes,
        durationMs: item.durationMs,
        licence: toJson({ name: "Crewcut built-in library (synthesised, royalty-free)", commercialUse: true, aiGenerated: false }),
        provenance: toJson({ provider: "crewcut-library", itemId: item.id }),
        ownerEmail: video?.row.ownerEmail ?? who.email,
        orgId: video?.row.orgId ?? who.orgId,
      });
    }
    return { assetId: id, kind: item.kind, mediaType: "audio" as const, label: item.label, durationMs: item.durationMs, url: await fileUrl("assets", fileName) };
  },
});
