import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { deleteAssetFile, findEditableAsset, videosUsingAsset } from "../server/lib/assets.js";
import { requireHuman } from "../server/lib/identity.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description: "Delete an uploaded media asset. Refuses while any of the person's videos still uses it (remove the clips first).",
  schema: z.object({ assetId: z.string() }),
  // Deleting removes the file for good: people only, and only media they can edit.
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ assetId }, ctx) => {
    requireHuman(ctx, "Deleting media");
    const row = await findEditableAsset(ctx, assetId);
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
