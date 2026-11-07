import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireAdmin } from "../server/lib/catalog.js";
import { requireHuman } from "../server/lib/identity.js";
import { nowIso } from "../server/lib/json.js";
import { newId } from "../server/lib/storage.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description:
    "Admins: create a catalog pack (leave packId out) or change one: name, description, tier (free or pro) and order. New packs start as drafts; publishing or unpublishing a pack (status) is people-only.",
  schema: z.object({
    packId: z.string().optional(),
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().trim().max(300).optional(),
    tier: z.enum(["free", "pro"]).optional(),
    status: z.enum(["draft", "published"]).optional(),
    sort: z.number().int().min(0).max(10_000).optional(),
  }),
  run: async ({ packId, name, description, tier, status, sort }, ctx) => {
    const who = requireAdmin(ctx);
    if (status !== undefined) requireHuman(ctx, "Publishing or unpublishing a pack");
    const db = getDb();
    if (!packId) {
      if (!name) throw new UserError("Give the pack a name.");
      const id = newId("pack");
      await db.insert(schema.catalogPacks).values({ id, name, description: description ?? "", tier: tier ?? "free", status: status ?? "draft", sort: sort ?? 100, createdBy: who.email, ownerEmail: who.email, visibility: "public" });
      return { packId: id, created: true };
    }
    const [pack] = await db.select().from(schema.catalogPacks).where(eq(schema.catalogPacks.id, packId)).limit(1);
    if (!pack) throw new UserError("That pack doesn't exist.");
    await db
      .update(schema.catalogPacks)
      .set({ ...(name ? { name } : {}), ...(description !== undefined ? { description } : {}), ...(tier ? { tier } : {}), ...(status ? { status } : {}), ...(sort !== undefined ? { sort } : {}), updatedAt: nowIso() })
      .where(eq(schema.catalogPacks.id, packId));
    return { packId, created: false };
  },
});
