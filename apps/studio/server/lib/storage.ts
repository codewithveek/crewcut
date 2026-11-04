import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Private media storage on the Node host (masterplan: Node host, not
 * serverless). Files are never public: the app hands out short-lived signed
 * URLs, served with range support by /api/media.
 */
function findWorkspaceRoot(start: string): string {
  let directory = path.resolve(start);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return path.resolve(start);
}

export const STORAGE_DIR = path.resolve(process.env.PROOFCUT_STORAGE_DIR ?? path.join(findWorkspaceRoot(process.cwd()), "storage"));
export const WORKSPACE_ROOT = findWorkspaceRoot(process.cwd());

export type StorageArea = "assets" | "renders" | "jobs";

export function storagePath(area: StorageArea, fileName: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(fileName)) throw new Error(`Unsafe file name "${fileName}"`);
  return path.join(STORAGE_DIR, area, fileName);
}

export async function writeStorageFile(area: StorageArea, fileName: string, bytes: Uint8Array | string): Promise<string> {
  const target = storagePath(area, fileName);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return target;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

// ── Signed media URLs ───────────────────────────────────────────────────────

const devSecret = randomBytes(32).toString("hex");

function mediaSecret(): string {
  const secret = process.env.PROOFCUT_MEDIA_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("Set PROOFCUT_MEDIA_SECRET to sign media URLs.");
  return devSecret;
}

const MEDIA_TTL_MS = 15 * 60 * 1000;

export function signMediaUrl(area: "assets" | "renders", fileName: string, ttlMs = MEDIA_TTL_MS): string {
  const expires = Date.now() + ttlMs;
  const signature = createHmac("sha256", mediaSecret()).update(`${area}/${fileName}:${expires}`).digest("base64url");
  return `/api/media/${area}/${encodeURIComponent(fileName)}?exp=${expires}&sig=${signature}`;
}

export function verifyMediaSignature(area: string, fileName: string, expires: string | null, signature: string | null): boolean {
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = createHmac("sha256", mediaSecret()).update(`${area}/${fileName}:${expires}`).digest();
  const given = Buffer.from(signature, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
