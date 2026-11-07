import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { canManageWorkspaceItem, isAdmin, loadItem } from "../server/lib/catalog.js";
import { requireHuman } from "../server/lib/identity.js";
import { nowIso } from "../server/lib/json.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description: "Remove a saved template from the workspace's gallery (people only). Videos already made from it keep everything they use.",
  schema: z.object({ templateId: z.string() }),
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ templateId }, ctx) => {
    const who = requireHuman(ctx, "Removing a template");
    const item = await loadItem(templateId);
    const allowed = item.scope === "workspace" ? canManageWorkspaceItem(who, item) : isAdmin(who);
    if (!allowed) throw new UserError("You can only remove templates you saved.");
    // Archived, not deleted: published versions stay, so nothing that came from it can break.
    await getDb().update(schema.catalogItems).set({ status: "archived", updatedAt: nowIso() }).where(eq(schema.catalogItems.id, item.id));
    return { templateId: item.id, removed: true };
  },
});
