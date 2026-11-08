import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { defineEventHandler, getQuery, getRouterParam } from "h3";

import { storagePath, verifyMediaSignature } from "../../../../lib/storage.js";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Private media behind short-lived signed URLs, with range requests for scrubbing. */
export default defineEventHandler(async (event) => {
  const area = getRouterParam(event, "area");
  const file = decodeURIComponent(getRouterParam(event, "file") ?? "");
  const query = getQuery(event) as { exp?: string; sig?: string; download?: string };
  if ((area !== "assets" && area !== "renders") || !/^[A-Za-z0-9._-]+$/.test(file)) return new Response("Not found", { status: 404 });
  if (!verifyMediaSignature(area, file, query.exp ?? null, query.sig ?? null)) return new Response("Link expired", { status: 403 });
  const filePath = storagePath(area, file);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return new Response("Not found", { status: 404 });
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "content-type": type,
    "accept-ranges": "bytes",
    // A file name never points at different bytes; cache until the link expires.
    "cache-control": `private, max-age=${Math.max(0, Math.floor((Number(query.exp) - Date.now()) / 1000))}, immutable`,
    "x-content-type-options": "nosniff",
    ...(query.download ? { "content-disposition": `attachment; filename="${file}"` } : {}),
  };
  const range = event.req.headers.get("range");
  const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${info.size}` } });
    const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${info.size}` } });
  }
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, "content-length": String(info.size) } });
});
