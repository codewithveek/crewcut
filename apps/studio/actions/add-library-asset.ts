import { defineAction } from "@agent-native/core/action";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { AUDIO_LIBRARY, ensureLibraryFile, LIBRARY_MIME, libraryFileName, libraryLicence } from "../server/lib/audio-library.js";
import { usableItem } from "../server/lib/catalog.js";
import { identity } from "../server/lib/identity.js";
import { toJson } from "../server/lib/json.js";
import { loadVideo } from "../server/lib/store.js";
import { fileUrl } from "../server/lib/blob-store.js";
import { newId } from "../server/lib/storage.js";
import { UserError } from "../server/lib/errors.js";

interface LibraryEntry {
  fileName: string;
  kind: string;
  label: string;
  mime: string;
  bytes: number;
  durationMs: number;
  licence: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

export default defineAction({
  description:
    "Make a library sound or track (from list-audio-library, including catalog ids starting cat:) available as an asset for a video (or the person's library). Returns the assetId to use with add-media-clip. Reuses the existing asset if it was added before.",
  schema: z.object({ itemId: z.string(), videoId: z.string().optional() }),
  run: async ({ itemId, videoId }, ctx) => {
    const who = identity(ctx);
    const video = videoId ? await loadVideo(videoId, ctx, "editor") : null;
    let entry: LibraryEntry;
    if (itemId.startsWith("cat:")) {
      const found = await usableItem(who, itemId.slice(4));
      if (!found || found.payload.type !== "audio") throw new UserError(`No library item "${itemId}"`);
      const { media, bpm } = found.payload;
      entry = {
        fileName: media.fileName,
        kind: found.item.kind === "sound" ? "sfx" : "music",
        label: found.item.name,
        mime: media.mime,
        bytes: media.bytes,
        durationMs: media.durationMs ?? 0,
        licence: media.licence,
        // The tier is written down now, so the export check sees what was added even if the pack changes later.
        provenance: { ...media.provenance, provider: "crewcut-catalog", itemId: found.item.id, version: found.version, ...(bpm ? { bpm } : {}), ...(found.tier === "pro" ? { catalogTier: "pro", catalogName: found.item.name } : {}) },
      };
    } else {
      const item = AUDIO_LIBRARY.find((candidate) => candidate.id === itemId);
      if (!item) throw new UserError(`No library item "${itemId}"`);
      entry = {
        fileName: libraryFileName(item),
        kind: item.kind,
        label: item.label,
        mime: LIBRARY_MIME,
        bytes: await ensureLibraryFile(item),
        durationMs: item.durationMs,
        licence: libraryLicence(item),
        provenance: { provider: "crewcut-library", itemId: item.id, ...(item.bpm ? { bpm: item.bpm } : {}) },
      };
    }
    const db = getDb();
    const scope = videoId ? eq(schema.assets.videoId, videoId) : and(isNull(schema.assets.videoId), eq(schema.assets.ownerEmail, who.email));
    const [existing] = await db.select().from(schema.assets).where(and(scope, eq(schema.assets.fileName, entry.fileName))).limit(1);
    const id = existing?.id ?? newId("ast");
    if (!existing) {
      await db.insert(schema.assets).values({
        id,
        videoId: videoId ?? null,
        kind: entry.kind,
        label: entry.label,
        fileName: entry.fileName,
        mime: entry.mime,
        bytes: entry.bytes,
        durationMs: entry.durationMs,
        licence: toJson(entry.licence),
        provenance: toJson(entry.provenance),
        ownerEmail: video?.row.ownerEmail ?? who.email,
        orgId: video?.row.orgId ?? who.orgId,
      });
    }
    return { assetId: id, kind: entry.kind, mediaType: "audio" as const, label: entry.label, durationMs: entry.durationMs, url: await fileUrl("assets", entry.fileName) };
  },
});
