import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";

import { builderFileUploadProvider, deleteUploadedFile, getActiveFileUploadProviderForRequest, uploadFile } from "@agent-native/core/file-upload";
import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { type StorageArea, signMediaUrl, storagePath, writeStorageFile } from "./storage.js";

/**
 * Where Crewcut's files live. Two backends behind one interface:
 *
 * - local: this host's disk (storage/), served through short-lived signed
 *   links by /api/media. The default for development.
 * - remote: Agent-Native's file storage (Builder-hosted, or any S3-compatible
 *   bucket such as Cloudflare R2 configured with R2_* / S3_* env vars or in the
 *   organisation's settings). Needed once the app runs on several servers or
 *   render workers run elsewhere.
 *
 * CREWCUT_STORAGE picks the backend: "local", "remote" (any configured
 * provider, Builder included; fail loudly when there is none) or "auto"
 * (default: a bucket you configured, such as R2, else local disk; "auto" never
 * moves files to Builder just because Builder is connected for models). The stored_files table records where each remote
 * file is; callers only ever ask for a file's URL by area + file name.
 *
 * Note: Agent-Native's S3/R2 provider serves files from the bucket's public
 * base URL (long, unguessable keys), unlike local storage's expiring links.
 */
export type StorageMode = "local" | "remote" | "auto";

export function storageMode(): StorageMode {
  const value = (process.env.CREWCUT_STORAGE ?? "auto").toLowerCase();
  return value === "local" || value === "remote" ? value : "auto";
}

type Provider = NonNullable<Awaited<ReturnType<typeof getActiveFileUploadProviderForRequest>>>;

async function remoteProvider(): Promise<Provider | null> {
  const mode = storageMode();
  if (mode === "local") return null;
  let provider = await getActiveFileUploadProviderForRequest().catch(() => null);
  if (mode === "auto" && provider?.id === builderFileUploadProvider.id) provider = null;
  if (!provider && mode === "remote") {
    throw new Error("CREWCUT_STORAGE=remote, but no file storage is configured. Set R2_* or S3_* environment variables, connect Builder, or set storage in the organisation settings.");
  }
  return provider;
}

const keyOf = (area: StorageArea, fileName: string) => `${area}/${fileName}`;

export interface StoredFile {
  provider: string;
  /** Remote URL, or null when the file is on local disk (use fileUrl for a signed link). */
  url: string | null;
}

/** Stores bytes in the active backend. `keepLocal` also keeps a disk copy (render inputs, regenerable library files). */
export async function putFile(area: StorageArea, fileName: string, bytes: Uint8Array, mime: string, options: { ownerEmail?: string; keepLocal?: boolean } = {}): Promise<StoredFile> {
  const provider = await remoteProvider();
  if (!provider || area === "jobs") {
    await writeStorageFile(area, fileName, bytes);
    return { provider: "local", url: null };
  }
  const result = await uploadFile({ data: bytes, filename: fileName, mimeType: mime, ...(options.ownerEmail ? { ownerEmail: options.ownerEmail } : {}), stableUrl: true });
  if (!result) {
    // Provider vanished between the check and the upload: never lose the file.
    await writeStorageFile(area, fileName, bytes);
    return { provider: "local", url: null };
  }
  const row = { key: keyOf(area, fileName), area, fileName, provider: result.provider, url: result.url, remoteId: result.id ?? null, mime, bytes: bytes.byteLength };
  await getDb().insert(schema.storedFiles).values(row).onConflictDoUpdate({ target: schema.storedFiles.key, set: { provider: row.provider, url: row.url, remoteId: row.remoteId, mime, bytes: row.bytes } });
  if (options.keepLocal) await writeStorageFile(area, fileName, bytes);
  return { provider: result.provider, url: result.url };
}

/** URLs for many files at once: the remote URL when stored remotely, else a signed local link. */
export async function resolveFileUrls(area: Exclude<StorageArea, "jobs">, fileNames: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(fileNames)];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;
  const rows = await getDb()
    .select({ fileName: schema.storedFiles.fileName, url: schema.storedFiles.url })
    .from(schema.storedFiles)
    .where(inArray(schema.storedFiles.key, unique.map((name) => keyOf(area, name))));
  for (const row of rows) urls.set(row.fileName, row.url);
  for (const name of unique) if (!urls.has(name)) urls.set(name, signMediaUrl(area, name));
  return urls;
}

export async function fileUrl(area: Exclude<StorageArea, "jobs">, fileName: string): Promise<string> {
  return (await resolveFileUrls(area, [fileName])).get(fileName) ?? signMediaUrl(area, fileName);
}

async function storedRow(area: StorageArea, fileName: string) {
  const [row] = await getDb().select().from(schema.storedFiles).where(eq(schema.storedFiles.key, keyOf(area, fileName))).limit(1);
  return row ?? null;
}

/** Deletes a file wherever it lives (remote object, index row, local copy). */
export async function removeFile(area: StorageArea, fileName: string): Promise<void> {
  const row = await storedRow(area, fileName);
  if (row) {
    await deleteUploadedFile(row.provider, { url: row.url, ...(row.remoteId ? { id: row.remoteId } : {}) }).catch(() => false);
    await getDb().delete(schema.storedFiles).where(eq(schema.storedFiles.key, row.key));
  }
  await unlink(storagePath(area, fileName)).catch(() => undefined);
}

/** A path on this host's disk, downloading a remote file first if needed (YouTube upload, render inputs). */
export async function localCopy(area: StorageArea, fileName: string): Promise<string> {
  const target = storagePath(area, fileName);
  if (existsSync(target)) return target;
  const row = await storedRow(area, fileName);
  if (!row) throw new Error(`File ${area}/${fileName} is not stored on this host or remotely`);
  const response = await fetch(row.url);
  if (!response.ok) throw new Error(`Couldn't download ${area}/${fileName} (${response.status})`);
  await writeStorageFile(area, fileName, new Uint8Array(await response.arrayBuffer()));
  return target;
}

/** Copies a file that so far exists only on disk (e.g. a finished render) to remote storage when it's active. */
export async function promoteToRemote(area: Exclude<StorageArea, "jobs">, fileName: string, mime: string, ownerEmail?: string): Promise<void> {
  if (storageMode() === "local" || (await storedRow(area, fileName))) return;
  const target = storagePath(area, fileName);
  if (!existsSync(target) || !(await remoteProvider())) return;
  await putFile(area, fileName, new Uint8Array(await readFile(target)), mime, { keepLocal: true, ...(ownerEmail ? { ownerEmail } : {}) });
}

/** True when a remote index row exists (callers can skip regenerating library files). */
export async function isStoredRemotely(area: StorageArea, fileName: string): Promise<boolean> {
  return Boolean(await storedRow(area, fileName));
}
