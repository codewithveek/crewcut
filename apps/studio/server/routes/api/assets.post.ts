import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { defineEventHandler, getQuery } from "h3";

import { getDb, schema } from "../../db/index.js";
import { toJson } from "../../lib/json.js";
import { newId, signMediaUrl, writeStorageFile } from "../../lib/storage.js";

const MAX_BYTES = 100 * 1024 * 1024;

/** Type sniffing on magic bytes — the declared content type is never trusted. */
function sniff(bytes: Uint8Array): { ext: string; mime: string; kind: "audio" | "image" | "video" } | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { ext: "wav", mime: "audio/wav", kind: "audio" };
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return { ext: "mp3", mime: "audio/mpeg", kind: "audio" };
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    return brand.startsWith("M4A") ? { ext: "m4a", mime: "audio/mp4", kind: "audio" } : { ext: "mp4", mime: "video/mp4", kind: "video" };
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { ext: "webm", mime: "video/webm", kind: "video" };
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return { ext: "png", mime: "image/png", kind: "image" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg", kind: "image" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", mime: "image/webp", kind: "image" };
  return null;
}

/**
 * Upload media for a video: POST /api/assets?videoId=…&role=music&label=…
 * with the raw file as the body. Licence is recorded as the uploader's own.
 */
export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  const email = session?.email ?? (process.env.NODE_ENV === "production" ? null : "local@localhost");
  if (!email) return Response.json({ error: { code: "unauthorized", message: "Sign in to upload." } }, { status: 401 });
  const query = getQuery(event) as { videoId?: string; role?: string; label?: string };
  const videoId = query.videoId;
  if (!videoId) return Response.json({ error: { code: "bad_request", message: "videoId is required" } }, { status: 400 });
  try {
    await assertAccess("video", videoId, "editor", { userEmail: email }, { skipResourceBody: true });
  } catch {
    return Response.json({ error: { code: "forbidden", message: "You can't edit this video." } }, { status: 403 });
  }
  const length = Number(event.req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return Response.json({ error: { code: "too_large", message: "Files are limited to 100 MB." } }, { status: 413 });
  const bytes = new Uint8Array(await event.req.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return Response.json({ error: { code: "too_large", message: "Files are limited to 100 MB." } }, { status: 413 });
  const type = sniff(bytes);
  if (!type) return Response.json({ error: { code: "unsupported", message: "Upload WAV, MP3, M4A, MP4, WebM, PNG, JPEG or WebP." } }, { status: 415 });

  return runWithRequestContext({ userEmail: email, ...(session?.orgId ? { orgId: session.orgId } : {}) }, async () => {
  const [video] = await getDb().select().from(schema.videos).where(eq(schema.videos.id, videoId)).limit(1);
  const id = newId("ast");
  const fileName = `${id}.${type.ext}`;
  await writeStorageFile("assets", fileName, bytes);
  const role = query.role === "music" || query.role === "sfx" || query.role === "voice" ? query.role : type.kind;
  await getDb().insert(schema.assets).values({
    id,
    videoId,
    kind: role,
    label: (query.label ?? fileName).slice(0, 120),
    fileName,
    mime: type.mime,
    bytes: bytes.byteLength,
    licence: toJson({ name: "Uploaded by the owner (licence asserted by uploader)", commercialUse: true, aiGenerated: false }),
    provenance: toJson({ provider: "upload", uploadedBy: email }),
    ownerEmail: video?.ownerEmail ?? email,
    orgId: video?.orgId ?? null,
  });
  return Response.json({ assetId: id, kind: role, mime: type.mime, bytes: bytes.byteLength, url: signMediaUrl("assets", fileName) });
  });
});
