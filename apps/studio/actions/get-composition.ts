import { defineAction } from "@agent-native/core/action";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { identity } from "../server/lib/identity.js";
import { referencedAssetIds } from "../server/lib/render-runner.js";
import { compositionAt, latestComposition, listCompositionVersions, loadVideo } from "../server/lib/store.js";
import { resolveFileUrls } from "../server/lib/blob-store.js";

export default defineAction({
  description: "Read the full composition JSON (tracks → clips → layers → keyframes) for a version (default latest), with its history and signed asset URLs.",
  schema: z.object({ videoId: z.string(), version: z.number().int().positive().optional() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ videoId, version }, ctx) => {
    const who = identity(ctx);
    const db = getDb();
    // The access check runs alongside the reads (one round trip instead of
    // four in a row); nothing is returned unless it passes.
    const [video, entry, versions, ownAssets] = await Promise.all([
      loadVideo(videoId, ctx),
      version ? compositionAt(videoId, version).then((composition) => ({ version, composition })) : latestComposition(videoId),
      listCompositionVersions(videoId),
      // This video's uploads and the person's library.
      db
        .select()
        .from(schema.assets)
        .where(or(eq(schema.assets.videoId, videoId), and(isNull(schema.assets.videoId), eq(schema.assets.ownerEmail, who.email)))),
    ]);
    if (!entry?.composition) return { composition: null, versions: [], assetUrls: {} };
    // Plus anything else the composition references (rare: the owner's other
    // uploads). Only the owner's or the caller's own files: an id typed into a
    // composition must never reveal someone else's file.
    const known = new Set(ownAssets.map((asset) => asset.id));
    const extra = referencedAssetIds(entry.composition).filter((id) => !known.has(id));
    const owners = [...new Set([video.row.ownerEmail, who.email])];
    const assets = extra.length
      ? [...ownAssets, ...(await db.select().from(schema.assets).where(and(inArray(schema.assets.id, extra), inArray(schema.assets.ownerEmail, owners))))]
      : ownAssets;
    const urls = await resolveFileUrls("assets", assets.map((asset) => asset.fileName));
    const assetUrls = Object.fromEntries(assets.map((asset) => [asset.id, urls.get(asset.fileName) ?? ""]));
    return { version: entry.version, composition: entry.composition, versions, assetUrls };
  },
});
