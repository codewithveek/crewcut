import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type AspectRatio, FRAME_SIZE, type TemplateDefinition, closestTemplateRatio, templateDurationMs } from "@crewcut/composition";
import { type StockPhoto, createStockClient, orientationFor, pickDistinct, stockCredit } from "@crewcut/stock";
import { composeMusic } from "@crewcut/voice";

import { getDb, schema } from "../db/index.js";
import { isStoredRemotely, putFile } from "./blob-store.js";
import { toJson } from "./json.js";
import { STORAGE_DIR, newId, storagePath } from "./storage.js";

/**
 * Media for templates: stock photo picks (one Pexels result per photo slot,
 * cached per template and orientation so browsing the gallery costs no API
 * calls) and one generated music bed per template, shared by every project
 * made from it.
 */

const PICKS_FILE = path.join(STORAGE_DIR, "templates", "stock-picks.json");
type PickCache = Record<string, Record<string, StockPhoto>>;
let picksCache: PickCache | null = null;
const pending = new Map<string, Promise<Record<string, StockPhoto>>>();

export function stockEnabled(): boolean {
  return Boolean(process.env.PEXELS_API_KEY);
}

async function loadPicks(): Promise<PickCache> {
  if (picksCache) return picksCache;
  try {
    picksCache = JSON.parse(await readFile(PICKS_FILE, "utf8")) as PickCache;
  } catch {
    picksCache = {};
  }
  return picksCache;
}

async function savePicks(cache: PickCache): Promise<void> {
  await mkdir(path.dirname(PICKS_FILE), { recursive: true });
  await writeFile(PICKS_FILE, JSON.stringify(cache, null, 1));
}

function shortHash(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}

/** The stock photo for each photo slot of a template in a ratio ({} without a Pexels key or on API errors). */
export async function stockPicks(template: TemplateDefinition, ratio: AspectRatio): Promise<Record<string, StockPhoto>> {
  const designed = closestTemplateRatio(template, ratio);
  const { width, height } = FRAME_SIZE[designed];
  const orientation = orientationFor(width, height);
  // Logos are the person's own; they never come from stock.
  const photoSlots = template.slots.filter((slot) => slot.kind === "photo" && !slot.logo);
  // The searches are part of the key: rewording a slot's search picks fresh photos.
  const key = `${template.id}:${orientation}:${shortHash(photoSlots.map((slot) => slot.default).join("|"))}`;
  const cache = await loadPicks();
  if (cache[key] && photoSlots.every((slot) => cache[key]?.[slot.id])) return cache[key] ?? {};
  if (!stockEnabled()) return {};
  let job = pending.get(key);
  if (!job) {
    job = (async () => {
      const client = createStockClient({ apiKey: process.env.PEXELS_API_KEY ?? "" });
      const results = await Promise.all(photoSlots.map((slot) => client.searchPhotos(slot.default, { orientation, perPage: 8 }).then((page) => page.photos)));
      const picks: Record<string, StockPhoto> = {};
      pickDistinct(results).forEach((photo, index) => {
        const slot = photoSlots[index];
        if (photo && slot) picks[slot.id] = photo;
      });
      const fresh = await loadPicks();
      fresh[key] = picks;
      await savePicks(fresh);
      return picks;
    })().finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return job.catch(() => ({}));
}

/** Downloads a stock photo into the video's assets, with the credit the Pexels terms ask for. Returns `asset:<id>`. */
export async function importStockPhoto(photo: StockPhoto, owner: { videoId: string; ownerEmail: string; orgId: string | null }): Promise<string> {
  const response = await fetch(photo.fullUrl);
  if (!response.ok) throw new Error(`Couldn't download the stock photo (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mime = response.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const id = newId("ast");
  const fileName = `${id}.${mime === "image/png" ? "png" : "jpg"}`;
  await putFile("assets", fileName, bytes, mime, { ownerEmail: owner.ownerEmail, keepLocal: true });
  await getDb()
    .insert(schema.assets)
    .values({
      id,
      videoId: owner.videoId,
      kind: "image",
      label: photo.alt ? photo.alt.slice(0, 80) : `Photo by ${photo.photographer}`,
      fileName,
      mime,
      bytes: bytes.byteLength,
      durationMs: null,
      licence: toJson({ name: "Pexels License", url: "https://www.pexels.com/license/", commercialUse: true, aiGenerated: false, credit: stockCredit(photo) }),
      provenance: toJson({ provider: "pexels", id: photo.id, photographer: photo.photographer, photographerUrl: photo.photographerUrl, pageUrl: photo.pageUrl }),
      ownerEmail: owner.ownerEmail,
      orgId: owner.orgId,
    });
  return `asset:${id}`;
}

// ── Music ───────────────────────────────────────────────────────────────────

/** "lib-" files are shared library files: deleting one project's asset row never deletes them. */
export function templateMusicFile(templateId: string): string {
  return `lib-template-${templateId}.mp3`;
}

export async function templateMusicReady(templateId: string): Promise<boolean> {
  const fileName = templateMusicFile(templateId);
  return existsSync(storagePath("assets", fileName)) || (await isStoredRemotely("assets", fileName));
}

/** Generates the template's music bed with ElevenLabs (once; `force` regenerates). */
export async function generateTemplateMusic(template: TemplateDefinition, options: { force?: boolean } = {}): Promise<{ fileName: string; bytes: number; durationMs: number; generated: boolean }> {
  const fileName = templateMusicFile(template.id);
  const durationMs = templateDurationMs(template);
  if (!options.force && (await templateMusicReady(template.id))) return { fileName, bytes: 0, durationMs, generated: false };
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY to generate template music.");
  // A little longer than the template so the last cut never lands on silence; the clip is trimmed to the video.
  const bytes = await composeMusic({ apiKey, prompt: template.music.prompt, durationMs: durationMs + 2000 });
  await putFile("assets", fileName, bytes, "audio/mpeg", { keepLocal: true });
  return { fileName, bytes: bytes.byteLength, durationMs, generated: true };
}

/** The template's music as an asset of this video, if the bed exists. */
export async function attachTemplateMusic(template: TemplateDefinition, owner: { videoId: string; ownerEmail: string; orgId: string | null }): Promise<{ assetId: string; label: string } | null> {
  if (!(await templateMusicReady(template.id))) return null;
  const id = newId("ast");
  const durationMs = templateDurationMs(template) + 2000;
  const label = `${template.name} theme`;
  await getDb()
    .insert(schema.assets)
    .values({
      id,
      videoId: owner.videoId,
      kind: "music",
      label,
      fileName: templateMusicFile(template.id),
      mime: "audio/mpeg",
      bytes: 0,
      durationMs,
      licence: toJson({ name: "Generated with ElevenLabs Eleven Music (paid plan, commercial use)", commercialUse: true, aiGenerated: true }),
      provenance: toJson({ provider: "elevenlabs-music", template: template.id, prompt: template.music.prompt }),
      ownerEmail: owner.ownerEmail,
      orgId: owner.orgId,
    });
  return { assetId: id, label };
}
