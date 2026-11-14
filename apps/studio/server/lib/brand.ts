import { readFile } from "node:fs/promises";

import { type BrandKit, type Composition, applyBrandStyle, brandKitIsEmpty, brandKitSchema, withBrandLogo } from "@crewcut/composition";
import { and, eq, like } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { localCopy, putFile } from "./blob-store.js";
import { workspaceOf } from "./catalog.js";
import { UserError } from "./errors.js";
import { imageSize } from "./image-size.js";
import { nowIso, parseJson, toJson } from "./json.js";
import { newId } from "./storage.js";

/**
 * Brand kits: one per workspace (an organisation, or a person's own space).
 * Reading never fails: a missing or damaged kit is an empty one.
 */

export async function readBrandKit(workspace: string): Promise<BrandKit> {
  const [row] = await getDb().select().from(schema.brandKits).where(eq(schema.brandKits.workspace, workspace)).limit(1);
  return parseJson(brandKitSchema, row?.kit, brandKitSchema.parse({}));
}

export async function saveBrandKit(workspace: string, kit: BrandKit, by: string): Promise<void> {
  const value = { kit: toJson(kit), updatedBy: by, updatedAt: nowIso() };
  await getDb().insert(schema.brandKits).values({ workspace, ...value }).onConflictDoUpdate({ target: schema.brandKits.workspace, set: value });
}

export function brandWorkspaceOf(owner: { ownerEmail: string; orgId: string | null }): string {
  return workspaceOf({ email: owner.ownerEmail, orgId: owner.orgId });
}

type VideoOwner = { id: string; ownerEmail: string; orgId: string | null };

/**
 * The logo as an asset this video can use. Exports only read a video's own
 * files and its owner's media, and the logo may be a teammate's, so then the
 * video gets its own copy (made once, then reused).
 */
export async function logoAssetForVideo(logoAssetId: string, video: VideoOwner): Promise<string | null> {
  const A = schema.assets;
  const db = getDb();
  const [logo] = await db.select().from(A).where(eq(A.id, logoAssetId)).limit(1);
  if (!logo || !logo.mime.startsWith("image/")) return null;
  if (logo.videoId === video.id || logo.ownerEmail === video.ownerEmail) return logo.id;
  const marker = `"brandLogoOf":"${logo.id}"`;
  const [copy] = await db
    .select({ id: A.id })
    .from(A)
    .where(and(eq(A.videoId, video.id), like(A.provenance, `%${marker}%`)))
    .limit(1);
  if (copy) return copy.id;
  const bytes = new Uint8Array(await readFile(await localCopy("assets", logo.fileName)));
  const id = newId("ast");
  const ext = logo.fileName.split(".").pop() ?? "png";
  const fileName = `${id}.${ext}`;
  await putFile("assets", fileName, bytes, logo.mime, { ownerEmail: video.ownerEmail, keepLocal: true });
  await db.insert(A).values({
    id,
    videoId: video.id,
    kind: "image",
    label: logo.label || "Logo",
    fileName,
    mime: logo.mime,
    bytes: bytes.byteLength,
    durationMs: null,
    licence: logo.licence,
    provenance: toJson({ provider: "brand", brandLogoOf: logo.id }),
    ownerEmail: video.ownerEmail,
    orgId: video.orgId,
  });
  return id;
}

export interface BrandParts {
  colors?: boolean;
  fonts?: boolean;
  logo?: boolean;
}

/**
 * Gets the brand ready for a video (the logo copy, when needed, is made
 * here) and returns the edit itself: a pure function, so it can be re-run on
 * a newer version when two edits race.
 */
export async function prepareBrandEdit(kit: BrandKit, video: VideoOwner, parts: BrandParts = {}): Promise<{ edit: (composition: Composition) => Composition; applied: string[] }> {
  const applied: string[] = [];
  const style: BrandKit = { ...kit, colors: parts.colors === false ? {} : kit.colors, fonts: parts.fonts === false ? {} : kit.fonts };
  if (Object.values(style.colors).some(Boolean)) applied.push("colours");
  if (style.fonts.display || style.fonts.body) applied.push("fonts");
  let logo: (NonNullable<BrandKit["logo"]> & { assetId: string }) | null = null;
  if (parts.logo && kit.logo) {
    const assetId = await logoAssetForVideo(kit.logo.assetId, video);
    if (assetId) {
      logo = { ...kit.logo, assetId };
      applied.push("logo");
    }
  }
  return {
    edit: (composition) => {
      const styled = applyBrandStyle(composition, style);
      return logo ? withBrandLogo(styled, logo) : styled;
    },
    applied,
  };
}

/**
 * For new videos: the workspace's brand, when its kit says to apply it to
 * this kind of video. Never blocks making the video: a problem with the kit
 * is logged and the video is made without it.
 */
export async function brandNewVideo(composition: Composition, video: VideoOwner, kind: "templates" | "drafts"): Promise<Composition> {
  try {
    const kit = await readBrandKit(brandWorkspaceOf(video));
    if (brandKitIsEmpty(kit) || !kit.autoApply[kind]) return composition;
    return (await prepareBrandEdit(kit, video, { logo: kit.autoApply.logo })).edit(composition);
  } catch (error) {
    console.warn(`[brand] ${video.id}: brand kit not applied:`, error instanceof Error ? error.message : error);
    return composition;
  }
}

/** Checks a logo the person picked: their image (or their workspace's), and how wide it is. */
export async function checkLogo(assetId: string, who: { email: string; orgId: string | null }): Promise<{ aspect: number; label: string }> {
  const [asset] = await getDb().select().from(schema.assets).where(eq(schema.assets.id, assetId)).limit(1);
  if (!asset || !(asset.ownerEmail === who.email || (who.orgId && asset.orgId === who.orgId))) throw new UserError("That logo isn't in your media. Upload it first.");
  if (!asset.mime.startsWith("image/")) throw new UserError("A logo must be a picture (PNG with a transparent background works best).");
  const size = imageSize(new Uint8Array(await readFile(await localCopy("assets", asset.fileName))));
  const aspect = size ? Math.min(20, Math.max(0.05, size.width / size.height)) : 1;
  return { aspect: Math.round(aspect * 1000) / 1000, label: asset.label };
}
