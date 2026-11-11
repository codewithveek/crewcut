import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { defineEventHandler, getQuery } from "h3";

import { getDb, schema } from "../../db/index.js";
import { toJson } from "../../lib/json.js";
import { fileUrl, putFile } from "../../lib/blob-store.js";
import { BodyTooLargeError, readBodyCapped } from "../../lib/http.js";
import { sniffMedia as sniff } from "../../lib/sniff.js";
import { newId } from "../../lib/storage.js";

const MAX_BYTES = 100 * 1024 * 1024;
/** Uploads each owner may keep in total (CREWCUT_STORAGE_QUOTA_MB, default 5 GB), so one account can't fill the disk. */
const QUOTA_BYTES = Math.max(1, Number(process.env.CREWCUT_STORAGE_QUOTA_MB ?? 5120)) * 1024 * 1024;

type VideoRow = typeof schema.videos.$inferSelect;

const AUDIO_ROLES = new Set(["music", "sfx", "voice", "audio"]);

/**
 * Upload media: POST /api/assets?videoId=…&role=music&label=…&durationMs=…
 * with the raw file as the body. Without videoId the file goes to the
 * person's library. Licence is recorded as the uploader's own.
 */
export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  const email = session?.email ?? (process.env.NODE_ENV === "production" ? null : "local@localhost");
  if (!email) return Response.json({ error: { code: "unauthorized", message: "Sign in to upload." } }, { status: 401 });
  const query = getQuery(event) as { videoId?: string; role?: string; label?: string; durationMs?: string };
  const videoId = query.videoId || null;
  const context = { userEmail: email, ...(session?.orgId ? { orgId: session.orgId } : {}) };
  let video: VideoRow | null = null;
  if (videoId) {
    try {
      // The access check reads the video row: keep it (no second query).
      const access = await runWithRequestContext(context, () => assertAccess("video", videoId, "editor", context));
      video = access.resource as VideoRow;
    } catch {
      return Response.json({ error: { code: "forbidden", message: "You can't edit this video." } }, { status: 403 });
    }
  }
  const length = Number(event.req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return Response.json({ error: { code: "too_large", message: "Files are limited to 100 MB." } }, { status: 413 });
  // Uploads count against the owner of where they land (the video's owner, or the uploader's library).
  const owner = video?.ownerEmail ?? email;
  const [usage] = await runWithRequestContext(context, () =>
    getDb()
      .select({ bytes: sql<number>`coalesce(sum(${schema.assets.bytes}), 0)` })
      .from(schema.assets)
      .where(and(eq(schema.assets.ownerEmail, owner), sql`${schema.assets.fileName} not like 'lib-%' and ${schema.assets.fileName} not like 'tpl-%' and ${schema.assets.fileName} not like 'cat-%'`)),
  );
  if (Number(usage?.bytes ?? 0) + Math.max(length, 0) > QUOTA_BYTES) {
    return Response.json({ error: { code: "quota", message: `Uploads are limited to ${Math.round(QUOTA_BYTES / 1024 ** 3)} GB per account. Delete media you no longer use to make room.` } }, { status: 413 });
  }
  // Stops reading at the limit: Content-Length can be missing or wrong (chunked uploads).
  let bytes: Uint8Array;
  try {
    bytes = await readBodyCapped(event.req, MAX_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return Response.json({ error: { code: "too_large", message: "Files are limited to 100 MB." } }, { status: 413 });
    return Response.json({ error: { code: "upload_interrupted", message: "The upload was interrupted. Try again." } }, { status: 400 });
  }
  if (bytes.byteLength === 0) return Response.json({ error: { code: "empty", message: "That file is empty." } }, { status: 400 });
  // The real size, now that it's known (the first check trusted Content-Length).
  if (Number(usage?.bytes ?? 0) + bytes.byteLength > QUOTA_BYTES) {
    return Response.json({ error: { code: "quota", message: `Uploads are limited to ${Math.round(QUOTA_BYTES / 1024 ** 3)} GB per account. Delete media you no longer use to make room.` } }, { status: 413 });
  }
  const sniffed = sniff(bytes);
  if (!sniffed) return Response.json({ error: { code: "unsupported", message: "Upload WAV, MP3, M4A, OGG, MP4, WebM, PNG, JPEG, GIF or WebP." } }, { status: 415 });
  // A WebM recorded from the microphone is audio-only; the role says so.
  const type = sniffed.ext === "webm" && AUDIO_ROLES.has(query.role ?? "") ? { ...sniffed, mime: "audio/webm", kind: "audio" as const } : sniffed;
  const durationMs = Number(query.durationMs);

  return runWithRequestContext({ userEmail: email, ...(session?.orgId ? { orgId: session.orgId } : {}) }, async () => {
  const id = newId("ast");
  const fileName = `${id}.${type.ext}`;
  // Keep a disk copy too: render workers and the preview read local files fastest.
  await putFile("assets", fileName, bytes, type.mime, { ownerEmail: video?.ownerEmail ?? email, keepLocal: true });
  const role = query.role === "music" || query.role === "sfx" || query.role === "voice" ? query.role : type.kind;
  await getDb().insert(schema.assets).values({
    id,
    videoId,
    kind: role,
    label: (query.label ?? fileName).slice(0, 120),
    fileName,
    mime: type.mime,
    bytes: bytes.byteLength,
    ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs: Math.round(durationMs) } : {}),
    licence: toJson({ name: "Uploaded by the owner (licence asserted by uploader)", commercialUse: true, aiGenerated: false }),
    provenance: toJson({ provider: "upload", uploadedBy: email }),
    ownerEmail: video?.ownerEmail ?? email,
    orgId: video?.orgId ?? null,
  });
  return Response.json({ assetId: id, kind: role, mime: type.mime, mediaType: type.mime.split("/")[0], bytes: bytes.byteLength, label: (query.label ?? fileName).slice(0, 120), url: await fileUrl("assets", fileName) });
  });
});
