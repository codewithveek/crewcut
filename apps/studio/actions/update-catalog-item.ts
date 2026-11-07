import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { categorySchema, currentPayload, loadItem, parsePayload, requireAdmin } from "../server/lib/catalog.js";
import { nowIso, toJson } from "../server/lib/json.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description:
    "Admins: change a catalog item. Name, description, category, tags, pack and order apply at once. A track's or sound's BPM and mood are part of its content: they go into its unpublished changes and go live when it's published (people only).",
  schema: z.object({
    itemId: z.string(),
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(300).optional(),
    category: categorySchema.optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
    packId: z.string().optional(),
    sort: z.number().int().min(0).max(10_000).optional(),
    bpm: z.number().positive().max(300).nullable().optional(),
    mood: z.string().trim().max(60).optional(),
  }),
  run: async ({ itemId, name, description, category, tags, packId, sort, bpm, mood }, ctx) => {
    requireAdmin(ctx);
    const item = await loadItem(itemId);
    if (item.scope !== "catalog") throw new UserError("That's a workspace's own template, not a catalog item.");
    const db = getDb();
    if (packId) {
      const [pack] = await db.select({ id: schema.catalogPacks.id }).from(schema.catalogPacks).where(eq(schema.catalogPacks.id, packId)).limit(1);
      if (!pack) throw new UserError("That pack doesn't exist.");
    }
    let draft: string | undefined;
    if (bpm !== undefined || mood !== undefined) {
      const base = parsePayload(item.draft) ?? (await currentPayload(item));
      if (base?.type !== "audio") throw new UserError("BPM and mood belong to music and sounds.");
      draft = toJson({ ...base, ...(bpm !== undefined ? { bpm } : {}), ...(mood !== undefined ? { mood } : {}) });
    }
    await db
      .update(schema.catalogItems)
      .set({
        ...(name ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(category ? { category } : {}),
        ...(tags ? { tags: toJson(tags) } : {}),
        ...(packId ? { packId } : {}),
        ...(sort !== undefined ? { sort } : {}),
        ...(draft ? { draft } : {}),
        updatedAt: nowIso(),
      })
      .where(eq(schema.catalogItems.id, item.id));
    return { itemId: item.id, unpublishedChanges: Boolean(draft) || parsePayload(item.draft) !== null };
  },
});
