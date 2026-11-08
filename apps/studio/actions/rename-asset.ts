import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { findEditableAsset } from "../server/lib/assets.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description: "Rename an uploaded media asset (its label in the media library).",
  schema: z.object({ assetId: z.string(), label: z.string().trim().min(1).max(120) }),
  run: async ({ assetId, label }, ctx) => {
    if (!(await findEditableAsset(ctx, assetId))) throw new UserError(`Asset ${assetId} not found`);
    await getDb().update(schema.assets).set({ label }).where(eq(schema.assets.id, assetId));
    return { assetId, label };
  },
});
