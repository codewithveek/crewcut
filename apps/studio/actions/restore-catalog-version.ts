import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadItem, requireAdmin } from "../server/lib/catalog.js";
import { requireHuman } from "../server/lib/identity.js";
import { nowIso } from "../server/lib/json.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description: "Admins (people only): make an earlier published version of a catalog item the current one (roll back).",
  schema: z.object({ itemId: z.string(), version: z.number().int().positive() }),
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ itemId, version }, ctx) => {
    requireAdmin(ctx);
    requireHuman(ctx, "Rolling back catalog content");
    const item = await loadItem(itemId);
    if (item.scope !== "catalog") throw new UserError("That's a workspace's own template, not a catalog item.");
    const [row] = await getDb()
      .select({ id: schema.catalogItemVersions.id })
      .from(schema.catalogItemVersions)
      .where(and(eq(schema.catalogItemVersions.itemId, item.id), eq(schema.catalogItemVersions.version, version)))
      .limit(1);
    if (!row) throw new UserError(`Version ${version} doesn't exist.`);
    await getDb().update(schema.catalogItems).set({ currentVersion: version, updatedAt: nowIso() }).where(eq(schema.catalogItems.id, item.id));
    return { itemId, currentVersion: version };
  },
});
