import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { compositionAt, latestComposition, listCompositionVersions, loadVideo } from "../server/lib/store.js";
import { signMediaUrl } from "../server/lib/storage.js";

export default defineAction({
  description: "Read the full composition JSON (tracks → clips → layers → keyframes) for a version (default latest), with its history and signed asset URLs.",
  schema: z.object({ videoId: z.string(), version: z.number().int().positive().optional() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ videoId, version }, ctx) => {
    await loadVideo(videoId, ctx);
    const entry = version ? { version, composition: await compositionAt(videoId, version) } : await latestComposition(videoId);
    if (!entry?.composition) return { composition: null, versions: [], assetUrls: {} };
    const [versions, assets] = await Promise.all([
      listCompositionVersions(videoId),
      getDb().select().from(schema.assets).where(eq(schema.assets.videoId, videoId)),
    ]);
    const assetUrls = Object.fromEntries(assets.map((asset) => [asset.id, signMediaUrl("assets", asset.fileName)]));
    return { version: entry.version, composition: entry.composition, versions, assetUrls };
  },
});
