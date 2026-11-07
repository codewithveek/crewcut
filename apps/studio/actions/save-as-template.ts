import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { canManageWorkspaceItem, categorySchema, currentPayload, loadItem, publishVersion, variantFromVideo, withVariant } from "../server/lib/catalog.js";
import { identity } from "../server/lib/identity.js";
import { toJson } from "../server/lib/json.js";
import { newId } from "../server/lib/storage.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description:
    "Save a video as a template for the person's workspace (it appears under Templates → Yours). slots lists the layers people can change (clipId + layerId from get-composition, with a plain label such as \"Headline\" or \"Product photo\"); text, photo and video layers can be slots. The video's media is copied with the template, so it keeps working if the video is deleted. Pass templateId to add this video's format (9:16, 16:9…) to a template saved before: slots with the same label line up across formats.",
  schema: z.object({
    videoId: z.string(),
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(300).optional(),
    category: categorySchema.optional(),
    slots: z.array(z.object({ clipId: z.string(), layerId: z.string(), label: z.string().trim().max(60).optional() })).min(1).max(40),
    templateId: z.string().optional().describe("Add this format to one of the workspace's saved templates instead of making a new one"),
  }),
  run: async ({ videoId, name, description, category, slots, templateId }, ctx) => {
    const who = identity(ctx);
    const variant = await variantFromVideo(ctx, { videoId, slots });
    const db = getDb();
    if (templateId) {
      const item = await loadItem(templateId);
      if (item.status === "archived" || !canManageWorkspaceItem(who, item)) throw new UserError("You can only add formats to templates you saved.");
      const existing = await currentPayload(item);
      if (existing?.type !== "data") throw new UserError("That template can't take another format.");
      await db
        .update(schema.catalogItems)
        .set({ ...(name ? { name } : {}), ...(description !== undefined ? { description } : {}), ...(category ? { category } : {}) })
        .where(eq(schema.catalogItems.id, item.id));
      const version = await publishVersion(item, withVariant(existing, variant), who.actorId);
      return { templateId: item.id, version, ratio: variant.ratio, slots: variant.slots.length, ...(variant.skipped.length ? { note: `${variant.skipped.length} missing file(s) were left out.` } : {}), path: `/templates?template=${item.id}` };
    }
    const id = newId("tpl");
    await db.insert(schema.catalogItems).values({
      id,
      scope: "workspace",
      packId: null,
      kind: "template",
      name: name ?? "My template",
      description: description ?? "",
      category: category ?? "social",
      tags: toJson([]),
      status: "draft",
      createdBy: who.actorId,
      ownerEmail: who.email,
      orgId: who.orgId,
    });
    const item = await loadItem(id);
    const version = await publishVersion(item, withVariant(null, variant), who.actorId);
    return { templateId: id, version, ratio: variant.ratio, slots: variant.slots.length, ...(variant.skipped.length ? { note: `${variant.skipped.length} missing file(s) were left out.` } : {}), path: `/templates?template=${id}` };
  },
});
