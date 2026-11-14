import { existsSync } from "node:fs";

import { thumbnailAtMs, thumbnailComposition, thumbnailVariantSchema } from "@crewcut/composition";

import { isStoredRemotely, promoteToRemote, removeFile } from "./blob-store.js";
import { UserError } from "./errors.js";
import { type ThumbnailOption, readPackaging, savePackaging } from "./packaging.js";
import { newId, sha256, storagePath } from "./storage.js";
import { renderStillPicture } from "./stills.js";
import { latestComposition } from "./store.js";

/**
 * The JPEG for a thumbnail option, rendered from the video's latest version.
 * A picture already rendered from the same version and the same option is
 * reused; a new one replaces the previous picture.
 */
export async function thumbnailPicture(video: { id: string; ownerEmail: string; orgId: string | null }, option: ThumbnailOption): Promise<{ fileName: string; reused: boolean }> {
  const current = await latestComposition(video.id);
  if (!current) throw new UserError("This video has nothing to make a thumbnail from yet.");
  const variant = thumbnailVariantSchema.parse(option);
  const key = sha256(`${current.version}\n${JSON.stringify({ atMs: variant.atMs, headline: variant.headline, style: variant.style, position: variant.position, logo: variant.logo })}`);
  const before = await readPackaging(video.id);
  if (before.rendered?.key === key) {
    const file = before.rendered.fileName;
    if (existsSync(storagePath("renders", file)) || (await isStoredRemotely("renders", file))) return { fileName: file, reused: true };
  }
  const fileName = `${newId("thm")}.jpg`;
  await renderStillPicture({ video, composition: thumbnailComposition(current.composition, variant), atMs: thumbnailAtMs(current.composition, variant), fileName });
  await promoteToRemote("renders", fileName, "image/jpeg", video.ownerEmail);
  // Re-read: options may have changed while the picture rendered.
  const after = await readPackaging(video.id);
  const previous = after.rendered?.fileName;
  after.rendered = { key, fileName };
  await savePackaging(video, after);
  if (previous && previous !== fileName) await removeFile("renders", previous).catch(() => undefined);
  return { fileName, reused: false };
}
