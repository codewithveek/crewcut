import { defineAction } from "@agent-native/core/action";
import { and, eq, isNull, like } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { toAssetDto } from "../server/lib/assets.js";
import { fileUrl, putFile } from "../server/lib/blob-store.js";
import { UserError } from "../server/lib/errors.js";
import { identity } from "../server/lib/identity.js";
import { toJson } from "../server/lib/json.js";
import { LinkImportError, fetchLink, labelFor } from "../server/lib/link-import.js";
import { mediaDurationMs } from "../server/lib/media-duration.js";
import { QUOTA_BYTES, QUOTA_MESSAGE, ownerMediaBytes } from "../server/lib/quota.js";
import { newId, sha256 } from "../server/lib/storage.js";
import { loadVideo } from "../server/lib/store.js";

export default defineAction({
  description:
    "Import media from a web address into a video's media (or the person's library when videoId is left out). A direct link to a picture, video or sound file (PNG, JPEG, GIF, WebP, MP4, WebM, MP3, M4A, WAV, OGG; up to 100 MB) is saved and returns assetId: use `asset:<assetId>` as an image/video layer's src or in add-media-clip. A web page returns `candidates` (its share image, pictures, videos and media links) instead: pick one and call again with its url. Never use it for YouTube, TikTok, Instagram or other video platforms (refused: their terms forbid downloading). Only import what the person asked for or clearly may use; media you import is marked \"licence not checked\" in the Proof report.",
  schema: z.object({
    url: z.string().trim().min(8).max(2000).describe("A direct link to a media file, or a web page to pick from"),
    videoId: z.string().optional(),
    label: z.string().trim().max(120).optional().describe("A name for it in the media list"),
    pageUrl: z.string().trim().max(2000).optional().describe("The page the link was found on (from a previous call's candidates), kept as its source"),
  }),
  run: async ({ url, videoId, label, pageUrl }, ctx) => {
    const who = identity(ctx);
    const video = videoId ? await loadVideo(videoId, ctx, "editor") : null;
    const owner = video?.row.ownerEmail ?? who.email;
    const orgId = video?.row.orgId ?? who.orgId;

    let fetched;
    try {
      fetched = await fetchLink(url);
    } catch (error) {
      if (error instanceof LinkImportError) throw new UserError(error.message);
      throw error;
    }
    if (fetched.kind === "page") {
      return {
        imported: false as const,
        page: { url: fetched.url, title: fetched.title },
        candidates: fetched.candidates,
        next:
          fetched.candidates.length > 0
            ? "This is a web page. Pick one of the candidates and call import-from-link again with its url (and pageUrl set to this page)."
            : "This page shows no pictures or media files Crewcut can use. Ask for a direct link to the file.",
      };
    }

    const { bytes, type } = fetched;
    // The same file from the same address, already in this video (or this library): reuse it.
    const sourceHash = sha256(`${fetched.url}\n${sha256(bytes)}`);
    const A = schema.assets;
    const [existing] = await getDb()
      .select()
      .from(A)
      .where(and(eq(A.ownerEmail, owner), video ? eq(A.videoId, video.row.id) : isNull(A.videoId), like(A.provenance, `%"sourceHash":"${sourceHash}"%`)))
      .limit(1);
    if (existing) {
      return { imported: true as const, reused: true, assetId: existing.id, asset: toAssetDto(existing, await fileUrl("assets", existing.fileName)) };
    }

    if ((await ownerMediaBytes(owner)) + bytes.byteLength > QUOTA_BYTES) throw new UserError(QUOTA_MESSAGE, 413);

    const id = newId("ast");
    const fileName = `${id}.${type.ext}`;
    const host = new URL(fetched.url).hostname;
    const durationMs = type.kind === "image" ? null : mediaDurationMs(bytes, type.ext);
    // A person importing asserts they may use it, as with an upload; the crew can't know.
    const licence =
      who.kind === "human"
        ? { name: `Imported from ${host} by the owner (licence asserted by importer)`, commercialUse: true, aiGenerated: false }
        : { name: `Found by the crew on ${host}: licence not checked`, commercialUse: false, aiGenerated: false, needsCheck: true };
    let source = pageUrl;
    if (source) {
      try {
        const parsed = new URL(source);
        source = parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
      } catch {
        source = undefined;
      }
    }
    await putFile("assets", fileName, bytes, type.mime, { ownerEmail: owner, keepLocal: true });
    const [row] = await getDb()
      .insert(A)
      .values({
        id,
        videoId: video?.row.id ?? null,
        kind: type.kind,
        label: labelFor(fetched.url, label),
        fileName,
        mime: type.mime,
        bytes: bytes.byteLength,
        durationMs,
        licence: toJson(licence),
        provenance: toJson({ provider: "link", sourceUrl: fetched.url, ...(source ? { pageUrl: source } : {}), sourceHash, importedBy: who.actorId }),
        ownerEmail: owner,
        orgId,
      })
      .returning();
    if (!row) throw new UserError("The file was saved but couldn't be read back. Try again.");
    return {
      imported: true as const,
      reused: false,
      assetId: id,
      asset: toAssetDto(row, await fileUrl("assets", fileName)),
      ...(type.kind !== "image" && durationMs === null ? { note: "Its length couldn't be read from the file; set the clip length on the timeline." } : {}),
    };
  },
});
