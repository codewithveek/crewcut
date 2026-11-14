import { type S3ClientConfig, presignS3GetUrl } from "@agent-native/core/file-upload";

/**
 * Links to files in the bucket (Cloudflare R2 or any S3-compatible store)
 * that work only for a while: SigV4 presigned GETs, so the bucket itself can
 * stay private and a leaked link stops working on its own.
 *
 * Links are cut per hour: every link made in the same hour for the same file
 * is identical, so browsers reuse the copy they already downloaded. A link
 * stays valid for `minHours` after it is handed out, and at most one hour
 * longer.
 *
 * Only the deployment's own bucket (S3_* or R2_* settings) is signed here. A
 * file stored by another provider, or a bucket a workspace saved in its own
 * settings, keeps the address it was stored with.
 */

const HOUR_MS = 60 * 60 * 1000;
/** Links the app shows people: long enough for an editing session. */
export const VIEW_LINK_HOURS = 6;
/** Links a render job downloads from: it may wait in the export queue first. */
export const RENDER_LINK_HOURS = 24;

export function bucketConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3ClientConfig | null {
  const clean = (value: string | undefined) => value?.trim() || undefined;
  const bucket = clean(env.S3_BUCKET) ?? clean(env.R2_BUCKET);
  const accessKeyId = clean(env.S3_ACCESS_KEY_ID) ?? clean(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = clean(env.S3_SECRET_ACCESS_KEY) ?? clean(env.R2_SECRET_ACCESS_KEY);
  const endpoint = (clean(env.S3_ENDPOINT) ?? clean(env.R2_ENDPOINT))?.replace(/\/+$/, "");
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint || !URL.canParse(endpoint)) return null;
  // Presigned links travel to browsers, so only an HTTPS endpoint can sign them.
  if (new URL(endpoint).protocol !== "https:") return null;
  return { bucket, accessKeyId, secretAccessKey, endpoint, region: clean(env.S3_REGION) ?? clean(env.R2_REGION) ?? "auto" };
}

/**
 * Addresses the deployment's bucket was stored under: the current public base
 * (S3_PUBLIC_BASE_URL / R2_PUBLIC_BASE_URL) and any former ones listed in
 * CREWCUT_MEDIA_PUBLIC_BASES (comma-separated), e.g. an r2.dev address used
 * before a custom domain. Without trailing slashes.
 */
function deploymentBases(env: NodeJS.ProcessEnv = process.env): string[] {
  const values = [env.S3_PUBLIC_BASE_URL?.trim() || env.R2_PUBLIC_BASE_URL?.trim() || "", ...(env.CREWCUT_MEDIA_PUBLIC_BASES ?? "").split(",")];
  return [...new Set(values.map((value) => value.trim().replace(/\/+$/, "")).filter((value) => value && URL.canParse(value)))];
}

export interface StoredObject {
  provider: string;
  url: string;
  remoteId: string | null;
}

/**
 * The object key to sign, when this row is in the deployment's bucket. The
 * stored URL must sit under one of the deployment's public bases: a row saved
 * while a workspace's own bucket was active has another base, and our keys
 * would sign a link into the wrong bucket.
 */
export function deploymentObjectKey(row: StoredObject, env: NodeJS.ProcessEnv = process.env): string | null {
  if (row.provider !== "s3" || !row.remoteId) return null;
  if (!deploymentBases(env).some((base) => row.url.startsWith(`${base}/`))) return null;
  // Keys come from the framework ("uploads/<time>-<random>-<name>"); refuse anything odd rather than sign it.
  if (row.remoteId.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  return row.remoteId;
}

export async function presignedObjectUrl(config: S3ClientConfig, key: string, options: { minHours?: number; now?: number } = {}): Promise<string> {
  const now = options.now ?? Date.now();
  const minMs = Math.max(1, options.minHours ?? VIEW_LINK_HOURS) * HOUR_MS;
  const windowStart = Math.floor(now / HOUR_MS) * HOUR_MS;
  // Valid from the start of this hour until at least `minHours` from now.
  const expiresInSeconds = Math.min(604_800, Math.ceil((HOUR_MS + minMs) / 1000));
  return presignS3GetUrl(config, key, { expiresInSeconds, now: new Date(windowStart) });
}

/**
 * A link for a stored object: presigned when it is in the deployment's
 * bucket, else the address it was stored with.
 */
export async function viewableUrl(row: StoredObject, options: { minHours?: number; now?: number } = {}): Promise<string> {
  const config = bucketConfigFromEnv();
  const key = config ? deploymentObjectKey(row) : null;
  if (!config || !key) return row.url;
  return presignedObjectUrl(config, key, options);
}
