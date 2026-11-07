import { defineAction } from "@agent-native/core/action";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveFileUrls } from "../server/lib/blob-store.js";
import { ensureBuiltinCatalog, parsePayload, requireAdmin, variantRatios } from "../server/lib/catalog.js";
import { parseJsonLoose } from "../server/lib/json.js";

export default defineAction({
  description:
    "Admins: the whole content catalog: packs (Free/Pro, draft/published) and every template, music track and sound with its status, versions and unpublished changes, plus workspaces given Pro. Change it with save-catalog-pack, update-catalog-item, publish-video-as-template; publishing and plans are people-only.",
  schema: z.object({ kind: z.enum(["template", "music", "sound"]).optional() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ kind }, ctx) => {
    requireAdmin(ctx);
    await ensureBuiltinCatalog();
    const db = getDb();
    const packs = await db.select().from(schema.catalogPacks).orderBy(asc(schema.catalogPacks.sort), asc(schema.catalogPacks.createdAt));
    const items = await db
      .select()
      .from(schema.catalogItems)
      .where(and(eq(schema.catalogItems.scope, "catalog"), kind ? eq(schema.catalogItems.kind, kind) : undefined))
      .orderBy(asc(schema.catalogItems.sort), desc(schema.catalogItems.createdAt));
    const catalogItems = items;
    const versions = catalogItems.length
      ? await db
          .select({ itemId: schema.catalogItemVersions.itemId, version: schema.catalogItemVersions.version, payload: schema.catalogItemVersions.payload, publishedAt: schema.catalogItemVersions.publishedAt, publishedBy: schema.catalogItemVersions.publishedBy })
          .from(schema.catalogItemVersions)
          .where(inArray(schema.catalogItemVersions.itemId, catalogItems.map((item) => item.id)))
          .orderBy(desc(schema.catalogItemVersions.version))
      : [];
    const audioFiles = [...versions.map((row) => parsePayload(row.payload)), ...catalogItems.map((item) => parsePayload(item.draft))].flatMap((payload) => (payload?.type === "audio" ? [payload.media.fileName] : []));
    const urls = await resolveFileUrls("assets", audioFiles);
    const summarize = (payload: ReturnType<typeof parsePayload>) => {
      if (!payload) return null;
      if (payload.type === "builtin") return { type: "builtin" as const, templateId: payload.templateId };
      if (payload.type === "data") return { type: "data" as const, ratios: variantRatios(payload), slots: payload.slots.length, durationMs: payload.durationMs };
      return { type: "audio" as const, url: urls.get(payload.media.fileName) ?? "", durationMs: payload.media.durationMs, bpm: payload.bpm, mood: payload.mood, licence: payload.media.licence, mime: payload.media.mime, bytes: payload.media.bytes };
    };
    const plans = await db.select().from(schema.workspacePlans).orderBy(desc(schema.workspacePlans.updatedAt));
    return {
      packs: packs.map((pack) => ({ ...pack, items: catalogItems.filter((item) => item.packId === pack.id && item.status !== "archived").length })),
      items: catalogItems.map((item) => {
        const own = versions.filter((row) => row.itemId === item.id);
        const draft = parsePayload(item.draft);
        return {
          id: item.id,
          kind: item.kind,
          name: item.name,
          description: item.description,
          category: item.category,
          tags: parseJsonLoose<string[]>(item.tags, []),
          packId: item.packId,
          status: item.status,
          sort: item.sort,
          currentVersion: item.currentVersion,
          current: summarize(parsePayload(own.find((row) => row.version === item.currentVersion)?.payload)),
          draft: summarize(draft),
          versions: own.map((row) => ({ version: row.version, publishedAt: row.publishedAt, publishedBy: row.publishedBy })),
          updatedAt: item.updatedAt,
        };
      }),
      plans,
    };
  },
});
