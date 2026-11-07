import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { categorySchema, currentPayload, loadItem, parsePayload, requireAdmin, variantFromVideo, withVariant } from "../server/lib/catalog.js";
import { nowIso, toJson } from "../server/lib/json.js";
import { newId } from "../server/lib/storage.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description:
    "Admins: turn a video into a catalog template (or another format of one, with itemId) as unpublished changes in a pack. slots lists the layers people can change (clipId + layerId from get-composition, with a plain label); slots with the same label line up across formats. The video's media is copied with it. Publishing it for everyone is people-only (in the admin area).",
  schema: z.object({
    videoId: z.string(),
    itemId: z.string().optional().describe("An existing catalog template to add this format to"),
    packId: z.string().optional().describe("Pack for a new template (required without itemId)"),
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(300).optional(),
    category: categorySchema.optional(),
    slots: z.array(z.object({ clipId: z.string(), layerId: z.string(), label: z.string().trim().max(60).optional() })).min(1).max(40),
  }),
  run: async ({ videoId, itemId, packId, name, description, category, slots }, ctx) => {
    const who = requireAdmin(ctx);
    const variant = await variantFromVideo(ctx, { videoId, slots });
    const db = getDb();
    if (itemId) {
      const item = await loadItem(itemId);
      if (item.scope !== "catalog" || item.kind !== "template") throw new UserError("That isn't a catalog template.");
      const base = parsePayload(item.draft) ?? (await currentPayload(item));
      if (base && base.type !== "data") throw new UserError("Built-in templates are designed in code; publish this as a new template instead.");
      await db
        .update(schema.catalogItems)
        .set({ draft: toJson(withVariant(base, variant)), ...(name ? { name } : {}), ...(description !== undefined ? { description } : {}), ...(category ? { category } : {}), updatedAt: nowIso() })
        .where(eq(schema.catalogItems.id, item.id));
      return { itemId: item.id, ratio: variant.ratio, slots: variant.slots.length, unpublished: true, ...(variant.skipped.length ? { note: `${variant.skipped.length} missing file(s) were left out.` } : {}) };
    }
    if (!packId) throw new UserError("Choose the pack this template goes in.");
    const [pack] = await db.select({ id: schema.catalogPacks.id }).from(schema.catalogPacks).where(eq(schema.catalogPacks.id, packId)).limit(1);
    if (!pack) throw new UserError("That pack doesn't exist.");
    const id = newId("cat");
    await db.insert(schema.catalogItems).values({
      id,
      scope: "catalog",
      packId,
      kind: "template",
      name: name ?? "New template",
      description: description ?? "",
      category: category ?? "social",
      tags: toJson([]),
      status: "draft",
      sort: 100,
      draft: toJson(withVariant(null, variant)),
      createdBy: who.email,
      ownerEmail: who.email,
      visibility: "public",
    });
    return { itemId: id, ratio: variant.ratio, slots: variant.slots.length, unpublished: true, ...(variant.skipped.length ? { note: `${variant.skipped.length} missing file(s) were left out.` } : {}) };
  },
});
