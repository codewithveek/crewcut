import { spawn } from "node:child_process";
import path from "node:path";

import { type Composition, type ExportResolution, iterateLayers } from "@crewcut/composition";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { UserError } from "./errors.js";
import { toJson } from "./json.js";
import { resolveFileUrls } from "./blob-store.js";
import { STORAGE_DIR, WORKSPACE_ROOT, newId, writeStorageFile } from "./storage.js";
import type { VideoRecord } from "./store.js";

/**
 * Rendering runs outside the web process (masterplan: separate render workers
 * with Chromium + ffmpeg). Two modes:
 * - queue: a Postgres DATABASE_URL and `pnpm worker` running — the worker claims rows.
 * - spawn (default with PGlite): the app launches one worker process per job and
 *   reads JSON progress lines from it.
 */
export type RenderMode = "queue" | "spawn";

export function renderMode(): RenderMode {
  const configured = process.env.CREWCUT_RENDER_MODE;
  if (configured === "queue" || configured === "spawn") return configured;
  return /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "") ? "queue" : "spawn";
}

/** Asset ids a composition references (`asset:<id>` in layers and audio clips). */
export function referencedAssetIds(composition: Composition): string[] {
  const ids = new Set<string>();
  for (const { layer } of iterateLayers(composition)) {
    if ((layer.type === "image" || layer.type === "video") && layer.src.startsWith("asset:")) ids.add(layer.src.slice(6));
  }
  for (const track of composition.tracks) {
    if (track.kind !== "audio") continue;
    for (const clip of track.clips) if (clip.src.startsWith("asset:")) ids.add(clip.src.slice(6));
  }
  return [...ids];
}

/**
 * Every media `src` in a composition must be one the render browser may load:
 * our own assets, inline images, or public https hosts. The render runs a
 * real browser inside the app's container, so a typed-in http://127.0.0.1,
 * metadata or file: address would otherwise be fetched from inside it.
 */
export function unsafeMediaSources(composition: Composition): string[] {
  const bad = new Set<string>();
  const check = (src: string) => {
    if (src === "" || src.startsWith("asset:") || src.startsWith("estimated:") || /^data:(image|audio)\//.test(src)) return;
    try {
      const url = new URL(src);
      const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      const internal =
        host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") ||
        /^[\d.]+$/.test(host) || host.includes(":"); // IP literals (v4 and v6): public media has a host name
      if (url.protocol === "https:" && !internal) return;
    } catch {
      // Not a URL (a relative path): the renderer can't load it either.
    }
    bad.add(src.slice(0, 120));
  };
  const walk = (value: unknown, depth: number): void => {
    if (depth > 40 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "src" && typeof item === "string") check(item);
      else walk(item, depth + 1);
    }
  };
  walk(composition, 0);
  return [...bad];
}

export interface QueueRenderInput {
  video: VideoRecord;
  composition: Composition;
  compositionVersion: number;
  reducedMotion: boolean;
  burnCaptions: boolean;
  /** Output size; the project's own size when left out. */
  resolution?: ExportResolution;
}

export async function queueRender(input: QueueRenderInput): Promise<{ renderId: string; mode: RenderMode }> {
  const unsafe = unsafeMediaSources(input.composition);
  if (unsafe.length > 0) throw new UserError(`This video points at media that can't be exported (${unsafe.slice(0, 3).join(", ")}). Replace it with an upload.`);
  const db = getDb();
  // One person can't fill the server with exports: a few at a time each.
  // Jobs that stopped reporting for 30 minutes don't count (a crashed worker).
  const [active] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.renderJobs)
    .where(and(eq(schema.renderJobs.ownerEmail, input.video.row.ownerEmail), inArray(schema.renderJobs.status, ["queued", "running"]), sql`(${schema.renderJobs.updatedAt})::timestamptz > now() - interval '30 minutes'`));
  if (Number(active?.count ?? 0) >= MAX_ACTIVE_RENDERS_PER_OWNER) {
    throw new UserError(`${MAX_ACTIVE_RENDERS_PER_OWNER} exports are already in progress. Wait for one to finish, then export again.`);
  }
  const renderId = newId("rnd");
  const assetIds = referencedAssetIds(input.composition);
  // Only this video's files and its owner's library: an asset id typed into a
  // composition never pulls someone else's file into a render.
  const A = schema.assets;
  const assets = assetIds.length
    ? await db
        .select()
        .from(A)
        .where(and(inArray(A.id, assetIds), or(eq(A.videoId, input.video.row.id), eq(A.ownerEmail, input.video.row.ownerEmail))))
    : [];
  const payload = {
    jobId: renderId,
    composition: input.composition,
    assetFiles: await (async () => {
      const urls = await resolveFileUrls("assets", assets.map((asset) => asset.fileName));
      // Signed local links (/api/media/…) stay local files; remote URLs are fetched by the worker.
      return assets.map((asset) => {
        const url = urls.get(asset.fileName);
        return { id: asset.id, fileName: asset.fileName, ...(url && /^https?:/.test(url) ? { url } : {}) };
      });
    })(),
    options: { reducedMotion: input.reducedMotion, burnCaptions: input.burnCaptions, ...(input.resolution ? { resolution: input.resolution } : {}) },
    outputFileName: `${renderId}.mp4`,
  };
  await db.insert(schema.renderJobs).values({
    id: renderId,
    videoId: input.video.row.id,
    compositionVersion: input.compositionVersion,
    ratio: input.composition.ratio,
    payload: toJson(payload),
    ownerEmail: input.video.row.ownerEmail,
    orgId: input.video.row.orgId,
  });
  const mode = renderMode();
  if (mode === "spawn") {
    const jobFile = await writeStorageFile("jobs", `${renderId}.json`, toJson(payload));
    startOrWait({ renderId, jobFile, owner: { userEmail: input.video.row.ownerEmail, orgId: input.video.row.orgId } });
  }
  return { renderId, mode };
}

const running = new Map<string, ReturnType<typeof spawn>>();

const MAX_ACTIVE_RENDERS_PER_OWNER = Math.max(1, Number(process.env.CREWCUT_MAX_RENDERS_PER_USER ?? 2));
/**
 * Exports running at once on this server. Each is a Chromium plus ffmpeg using
 * every core it gets, so on a small machine one at a time finishes each
 * export sooner than two sharing the CPU (and can't run out of memory).
 */
const MAX_PARALLEL_RENDERS = Math.max(1, Number(process.env.CREWCUT_MAX_PARALLEL_RENDERS ?? 1));

interface WaitingRender {
  renderId: string;
  jobFile: string;
  owner: { userEmail: string; orgId: string | null };
}
const waiting: WaitingRender[] = [];

function startOrWait(job: WaitingRender): void {
  if (running.size < MAX_PARALLEL_RENDERS) spawnWorker(job.renderId, job.jobFile, job.owner);
  else waiting.push(job); // Stays "queued" in the database until a slot frees up.
}

function startNextWaiting(): void {
  while (running.size < MAX_PARALLEL_RENDERS && waiting.length > 0) {
    const next = waiting.shift() as WaitingRender;
    spawnWorker(next.renderId, next.jobFile, next.owner);
  }
}

type JobPatch = Partial<typeof schema.renderJobs.$inferInsert>;

/**
 * Progress arrives after the request that started the render has ended, so
 * each write re-establishes the owner's request context (Agent-Native scopes
 * database work to one). Failures are logged, never swallowed.
 */
function jobWriter(renderId: string, owner: { userEmail: string; orgId: string | null }) {
  let chain: Promise<unknown> = Promise.resolve();
  // Patches that arrive while a write is waiting merge into it: on a slow
  // database link, progress never queues up behind itself and "done" lands
  // as soon as the write before it finishes.
  let pending: JobPatch | null = null;
  return (patch: JobPatch) => {
    const scheduled = pending !== null;
    pending = { ...(pending ?? {}), ...patch };
    if (scheduled) return chain;
    chain = chain.then(() => {
      const next = pending ?? {};
      pending = null;
      return Promise.resolve(
        runWithRequestContext({ userEmail: owner.userEmail, ...(owner.orgId ? { orgId: owner.orgId } : {}) }, () =>
          getDb()
            .update(schema.renderJobs)
            .set({ ...next, updatedAt: new Date().toISOString() })
            .where(eq(schema.renderJobs.id, renderId)),
        ),
      ).catch((error: unknown) => console.error(`[render ${renderId}] could not record progress:`, error));
    });
    return chain;
  };
}

function spawnWorker(renderId: string, jobFile: string, owner: { userEmail: string; orgId: string | null }): void {
  const workerMain = path.join(WORKSPACE_ROOT, "apps", "render-worker", "src", "main.ts");
  const child = spawn(process.execPath, ["--import", "tsx", workerMain, "--job-file", jobFile], {
    cwd: path.join(WORKSPACE_ROOT, "apps", "render-worker"),
    env: { ...process.env, CREWCUT_STORAGE_DIR: STORAGE_DIR },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  running.set(renderId, child);
  const write = jobWriter(renderId, owner);
  let buffer = "";
  let stderr = "";
  let finished = false;
  void write({ status: "running", stage: "starting", lockedBy: `spawn:${child.pid ?? "?"}` });
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.startsWith("{")) continue;
      try {
        const message = JSON.parse(line) as { type: string; fraction?: number; stage?: string; bytes?: number; error?: string; outputFileName?: string };
        if (message.type === "progress") {
          void write({ progress: message.fraction ?? 0, stage: message.stage ?? "rendering" });
        } else if (message.type === "done") {
          finished = true;
          void write({ status: "done", progress: 1, stage: "done", outputFile: message.outputFileName ?? `${renderId}.mp4`, outputBytes: message.bytes ?? null, error: null });
        } else if (message.type === "failed") {
          finished = true;
          void write({ status: "failed", error: (message.error ?? "Render failed").slice(0, 2000) });
        }
      } catch {
        // Not a progress line.
      }
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4000);
  });
  child.on("exit", (code) => {
    running.delete(renderId);
    startNextWaiting();
    if (code !== 0 && !finished) {
      void write({ status: "failed", error: (stderr || `Render worker exited with code ${code}`).slice(-2000) });
    }
  });
  child.on("error", (error) => {
    running.delete(renderId);
    startNextWaiting();
    void write({ status: "failed", error: `Couldn't start the render worker: ${error.message}` });
  });
}

export function cancelRender(renderId: string): boolean {
  const queued = waiting.findIndex((job) => job.renderId === renderId);
  if (queued >= 0) {
    waiting.splice(queued, 1);
    return true;
  }
  const child = running.get(renderId);
  if (!child) return false;
  child.kill();
  return true;
}
