import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { deleteAssetFile, listVisibleAssets, videosUsingAsset } from "../server/lib/assets.js";

export default defineAction({
  description: "Delete an uploaded media asset. Refuses while any of the person's videos still uses it (remove the clips first).",
  schema: z.object({ assetId: z.string() }),
  run: async ({ assetId }, ctx) => {
    const visible = await listVisibleAssets(ctx, { scope: "all" });
    const row = visible.find((asset) => asset.id === assetId);
    if (!row) throw new Error(`Asset ${assetId} not found`);
    const users = await videosUsingAsset(ctx, assetId);
    if (users.length > 0) {
      throw new Error(`"${row.label}" is still used in ${users.map((video) => `"${video.title}"`).join(", ")}. Remove it from the timeline first.`);
    }
    await getDb().delete(schema.assets).where(eq(schema.assets.id, assetId));
    await deleteAssetFile(row);
    return { deleted: assetId };
  },
});
