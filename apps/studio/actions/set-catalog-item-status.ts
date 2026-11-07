import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { currentPayload, loadItem, parsePayload, publishVersion, requireAdmin } from "../server/lib/catalog.js";
import { requireHuman } from "../server/lib/identity.js";
import { nowIso } from "../server/lib/json.js";
import { UserError } from "../server/lib/errors.js";

/**
 * People-only. "published" publishes the item's unpublished changes as a new
 * version (or shows the current version again); "draft" hides it from the
 * galleries; "archived" retires it. Versions are never deleted, so videos
 * made from earlier versions keep working.
 */
export default defineAction({
  description: "Admins (people only): publish a catalog item (its unpublished changes become a new version), unpublish it (draft) or archive it.",
  schema: z.object({ itemId: z.string(), status: z.enum(["published", "draft", "archived"]) }),
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ itemId, status }, ctx) => {
    const who = requireAdmin(ctx);
    requireHuman(ctx, "Publishing catalog content");
    const item = await loadItem(itemId);
    if (item.scope !== "catalog") throw new UserError("That's a workspace's own template, not a catalog item.");
    if (status === "published") {
      const draft = parsePayload(item.draft);
      if (draft) {
        const version = await publishVersion(item, draft, who.email);
        return { itemId, status, version };
      }
      if (!(await currentPayload(item))) throw new UserError("There's nothing to publish yet.");
    }
    await getDb().update(schema.catalogItems).set({ status, updatedAt: nowIso() }).where(eq(schema.catalogItems.id, item.id));
    return { itemId, status, version: item.currentVersion };
  },
});
