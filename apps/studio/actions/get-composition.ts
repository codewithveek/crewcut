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
    await loadVideo(videoId, ctx);
    const who = identity(ctx);
    const entry = version ? { version, composition: await compositionAt(videoId, version) } : await latestComposition(videoId);
    if (!entry?.composition) return { composition: null, versions: [], assetUrls: {} };
    const referenced = referencedAssetIds(entry.composition);
    // This video's uploads, the person's library, and anything the composition references.
    const where = or(
      eq(schema.assets.videoId, videoId),
      and(isNull(schema.assets.videoId), eq(schema.assets.ownerEmail, who.email)),
      ...(referenced.length ? [inArray(schema.assets.id, referenced)] : []),
    );
    const [versions, assets] = await Promise.all([listCompositionVersions(videoId), getDb().select().from(schema.assets).where(where)]);
    const urls = await resolveFileUrls("assets", assets.map((asset) => asset.fileName));
    const assetUrls = Object.fromEntries(assets.map((asset) => [asset.id, urls.get(asset.fileName) ?? ""]));
    return { version: entry.version, composition: entry.composition, versions, assetUrls };
  },
});
