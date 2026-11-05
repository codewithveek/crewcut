import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { listVisibleAssets } from "../server/lib/assets.js";

export default defineAction({
  description: "Rename an uploaded media asset (its label in the media library).",
  schema: z.object({ assetId: z.string(), label: z.string().trim().min(1).max(120) }),
  run: async ({ assetId, label }, ctx) => {
    const visible = await listVisibleAssets(ctx, { scope: "all" });
    if (!visible.some((asset) => asset.id === assetId)) throw new Error(`Asset ${assetId} not found`);
    await getDb().update(schema.assets).set({ label }).where(eq(schema.assets.id, assetId));
    return { assetId, label };
  },
});
