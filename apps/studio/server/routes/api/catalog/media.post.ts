import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { defineEventHandler, getQuery } from "h3";

import { getDb, schema } from "../../../db/index.js";
import { isAdmin, parsePayload, currentPayload, storeSharedFile } from "../../../lib/catalog.js";
import { nowIso, toJson } from "../../../lib/json.js";
import { sniffMedia } from "../../../lib/sniff.js";
import { newId } from "../../../lib/storage.js";

const MAX_BYTES = 60 * 1024 * 1024;

const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

/**
 * Admins upload catalog music and sounds: POST /api/catalog/media with the
 * raw audio file as the body and its details in the query (kind, name,
 * packId, durationMs, bpm, mood, licence, licenceUrl, credit, commercialUse,
 * aiGenerated). itemId replaces the file of an existing item instead. The file
 * is stored once under a content name (`cat-<hash>`, in R2 when it's set up)
 * and the item gets it as unpublished changes: publishing stays a separate,
 * deliberate step.
 */
export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  const email = session?.email ?? (process.env.NODE_ENV === "production" ? null : "local@localhost");
  if (!email) return fail(401, "unauthorized", "Sign in to upload.");
  if (!isAdmin({ email })) return fail(403, "forbidden", "Only Crewcut admins can add catalog media.");
  const query = getQuery(event) as Record<string, string | undefined>;
  const kind = query.kind === "sound" ? "sound" : query.kind === "music" ? "music" : null;
  const itemId = query.itemId || null;
  if (!kind && !itemId) return fail(400, "bad_request", "Say whether this is music or a sound.");
  const licence = (query.licence ?? "").trim();
  if (!licence) return fail(400, "licence_required", "Say where the file comes from and under which licence, so every video that uses it can credit it.");
  const length = Number(event.req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return fail(413, "too_large", "Catalog audio is limited to 60 MB.");
  const bytes = new Uint8Array(await event.req.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return fail(413, "too_large", "Catalog audio is limited to 60 MB.");
  const type = sniffMedia(bytes);
  if (!type || (type.kind !== "audio" && type.ext !== "webm")) return fail(415, "unsupported", "Upload MP3, WAV, M4A or OGG audio.");
  const mime = type.kind === "audio" ? type.mime : "audio/webm";
  const durationMs = Number(query.durationMs);
  const bpm = Number(query.bpm);

  return runWithRequestContext({ userEmail: email, ...(session?.orgId ? { orgId: session.orgId } : {}) }, async () => {
    const db = getDb();
    const fileName = await storeSharedFile("cat-", bytes, mime, type.ext);
    const media = {
      fileName,
      mime,
      kind: kind ?? "music",
      label: (query.name ?? "Untitled").slice(0, 120),
      bytes: bytes.byteLength,
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null,
      licence: {
        name: licence.slice(0, 200),
        ...(query.licenceUrl && /^https:\/\//.test(query.licenceUrl) ? { url: query.licenceUrl.slice(0, 500) } : {}),
        ...(query.credit ? { credit: query.credit.slice(0, 200) } : {}),
        commercialUse: query.commercialUse !== "0",
        aiGenerated: query.aiGenerated === "1",
      },
      provenance: { provider: "crewcut-catalog", uploadedBy: email, uploadedAt: nowIso() },
    };
    if (itemId) {
      const [item] = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, itemId)).limit(1);
      if (!item || item.scope !== "catalog" || (item.kind !== "music" && item.kind !== "sound")) return fail(404, "not_found", "That catalog track doesn't exist.");
      const base = parsePayload(item.draft) ?? (await currentPayload(item));
      const draft = { type: "audio" as const, bpm: base?.type === "audio" ? base.bpm : null, mood: base?.type === "audio" ? base.mood : "", media: { ...media, kind: item.kind } };
      await db.update(schema.catalogItems).set({ draft: toJson(draft), updatedAt: nowIso() }).where(eq(schema.catalogItems.id, item.id));
      return Response.json({ itemId: item.id, fileName, unpublished: true });
    }
    const packId = query.packId || null;
    if (!packId) return fail(400, "bad_request", "Choose the pack this goes in.");
    const [pack] = await db.select({ id: schema.catalogPacks.id }).from(schema.catalogPacks).where(eq(schema.catalogPacks.id, packId)).limit(1);
    if (!pack) return fail(404, "not_found", "That pack doesn't exist.");
    const id = newId("cat");
    const draft = { type: "audio" as const, bpm: Number.isFinite(bpm) && bpm > 0 && bpm <= 300 ? bpm : null, mood: (query.mood ?? "").slice(0, 60), media };
    await db.insert(schema.catalogItems).values({
      id,
      scope: "catalog",
      packId,
      kind: kind ?? "music",
      name: media.label,
      status: "draft",
      sort: 100,
      draft: toJson(draft),
      createdBy: email,
      ownerEmail: email,
      visibility: "public",
    });
    return Response.json({ itemId: id, fileName, unpublished: true });
  });
});
