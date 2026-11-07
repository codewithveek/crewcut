import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { deleteAssetFile, findVisibleAsset, videosUsingAsset } from "../server/lib/assets.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description: "Delete an uploaded media asset. Refuses while any of the person's videos still uses it (remove the clips first).",
  schema: z.object({ assetId: z.string() }),
  run: async ({ assetId }, ctx) => {
    const row = await findVisibleAsset(ctx, assetId);
    if (!row) throw new UserError(`Asset ${assetId} not found`);
    const users = await videosUsingAsset(ctx, assetId);
    if (users.length > 0) {
      throw new UserError(`"${row.label}" is still used in ${users.map((video) => `"${video.title}"`).join(", ")}. Remove it from the timeline first.`);
    }
    await getDb().delete(schema.assets).where(eq(schema.assets.id, assetId));
    await deleteAssetFile(row);
    return { deleted: assetId };
  },
});
