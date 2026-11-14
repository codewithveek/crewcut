import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";

import { type Composition, type ExportResolution, iterateLayers } from "@crewcut/composition";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { UserError } from "./errors.js";
import { toJson } from "./json.js";
import { resolveFileUrls } from "./blob-store.js";
import { RENDER_LINK_HOURS } from "./media-links.js";
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
  /** Studio: jumps the queue of exports waiting for a free slot. */
  priority?: boolean;
}

/**
 * The media files a render of this composition reads. Only this video's files
 * and its owner's media: an asset id typed into a composition never pulls
 * someone else's file into a render. Bucket links outlive a wait in the queue
 * (the worker downloads them when it starts); local files stay local.
 */
export async function renderAssetFiles(video: { id: string; ownerEmail: string }, composition: Composition): Promise<Array<{ id: string; fileName: string; url?: string }>> {
  const assetIds = referencedAssetIds(composition);
  if (assetIds.length === 0) return [];
  const A = schema.assets;
  const assets = await getDb()
    .select()
    .from(A)
    .where(and(inArray(A.id, assetIds), or(eq(A.videoId, video.id), eq(A.ownerEmail, video.ownerEmail))));
  const urls = await resolveFileUrls("assets", assets.map((asset) => asset.fileName), { minHours: RENDER_LINK_HOURS });
  // Signed local links (/api/media/…) stay local files; remote URLs are fetched by the worker.
  return assets.map((asset) => {
    const url = urls.get(asset.fileName);
    return { id: asset.id, fileName: asset.fileName, ...(url && /^https?:/.test(url) ? { url } : {}) };
  });
}

export async function queueRender(input: QueueRenderInput): Promise<{ renderId: string; mode: RenderMode }> {
  const unsafe = unsafeMediaSources(input.composition);
  if (unsafe.length > 0) throw new UserError(`This video points at media that can't be exported (${unsafe.slice(0, 3).join(", ")}). Replace it with an upload.`);
  // Exports share the server (one at a time by default): a many-hour video would hold up everyone else's.
  const minutes = input.composition.durationMs / 60_000;
  if (minutes > MAX_EXPORT_MINUTES) {
    throw new UserError(`Exports can be up to ${MAX_EXPORT_MINUTES} minutes long, and this video is ${Math.ceil(minutes)}. Split it into parts and export each.`);
  }
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
  const payload = {
    jobId: renderId,
    composition: input.composition,
    assetFiles: await renderAssetFiles(input.video.row, input.composition),
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
    startOrWait({ renderId, jobFile, owner: { userEmail: input.video.row.ownerEmail, orgId: input.video.row.orgId }, priority: input.priority === true, durationMs: input.composition.durationMs });
  }
  return { renderId, mode };
}

const running = new Map<string, ReturnType<typeof spawn>>();
/** Exports a person stopped: their worker's exit must not be recorded as a failure. */
const cancelled = new Set<string>();

/** Longest video any plan can export (CREWCUT_MAX_EXPORT_MINUTES); each plan's own limit is in plans.ts. */
const MAX_EXPORT_MINUTES = Math.max(1, Number(process.env.CREWCUT_MAX_EXPORT_MINUTES ?? 180));
/** No export may run longer than this, whatever its length (CREWCUT_RENDER_TIMEOUT_MINUTES, default 12 hours). */
const RENDER_TIMEOUT_CAP_MS = Math.max(5, Number(process.env.CREWCUT_RENDER_TIMEOUT_MINUTES ?? 720)) * 60_000;

/**
 * How long an export may run before it's stopped as stuck: eight times the
 * video's length (a slow 4K render on two cores), never under half an hour,
 * never over the cap. Others are waiting behind it.
 */
function renderTimeoutMs(durationMs: number): number {
  return Math.min(RENDER_TIMEOUT_CAP_MS, Math.max(30 * 60_000, durationMs * 8));
}

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
  priority?: boolean;
  /** The video's length, which sets how long the export may run. */
  durationMs: number;
}
const waiting: WaitingRender[] = [];

function startOrWait(job: WaitingRender): void {
  if (running.size < MAX_PARALLEL_RENDERS) spawnWorker(job.renderId, job.jobFile, job.owner, renderTimeoutMs(job.durationMs));
  // Stays "queued" in the database until a slot frees up; priority exports go ahead of the others.
  else if (job.priority) {
    const firstOrdinary = waiting.findIndex((entry) => !entry.priority);
    waiting.splice(firstOrdinary === -1 ? waiting.length : firstOrdinary, 0, job);
  }
  else waiting.push(job);
}

function startNextWaiting(): void {
  while (running.size < MAX_PARALLEL_RENDERS && waiting.length > 0) {
    const next = waiting.shift() as WaitingRender;
    spawnWorker(next.renderId, next.jobFile, next.owner, renderTimeoutMs(next.durationMs));
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

function spawnWorker(renderId: string, jobFile: string, owner: { userEmail: string; orgId: string | null }, timeoutMs: number): void {
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
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  timeout.unref?.();
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
    clearTimeout(timeout);
    running.delete(renderId);
    // The job file was only this worker's input.
    void unlink(jobFile).catch(() => undefined);
    startNextWaiting();
    if (cancelled.delete(renderId)) {
      // Whatever the worker had written so far is not a finished video.
      void unlink(path.join(STORAGE_DIR, "renders", `${renderId}.mp4`)).catch(() => undefined);
      return;
    }
    if (timedOut && !finished) {
      void unlink(path.join(STORAGE_DIR, "renders", `${renderId}.mp4`)).catch(() => undefined);
      void write({ status: "failed", error: `The export ran for more than ${Math.round(timeoutMs / 60_000)} minutes and was stopped. Try a lower resolution or a shorter video.` });
      return;
    }
    if (code !== 0 && !finished) {
      void write({ status: "failed", error: (stderr || `Render worker exited with code ${code}`).slice(-2000) });
    }
  });
  child.on("error", (error) => {
    clearTimeout(timeout);
    running.delete(renderId);
    startNextWaiting();
    void write({ status: "failed", error: `Couldn't start the render worker: ${error.message}` });
  });
}

/** True while this server process is running the export or holding it in its queue. */
export function ownsRender(renderId: string): boolean {
  return running.has(renderId) || waiting.some((job) => job.renderId === renderId);
}

/** Spawn mode: a quiet export this long has lost its worker (progress is written every few seconds). */
const SPAWN_STALE_MINUTES = 10;
/** Queue mode: workers retry a job that went quiet themselves; this is for one that used up its attempts. */
const QUEUE_STALE_MINUTES = 45;

/**
 * Marks exports that can never finish as failed, so they stop showing
 * "Exporting…" for ever. In spawn mode the worker is a child of the web
 * server: a restart, deploy or sleeping container takes the worker and the
 * in-memory queue with it, and the job's row would say "running" for good.
 * Returns how many were closed.
 */
export async function failStaleRenders(): Promise<number> {
  const R = schema.renderJobs;
  const mode = renderMode();
  const minutes = mode === "spawn" ? SPAWN_STALE_MINUTES : QUEUE_STALE_MINUTES;
  const quiet = sql`(${R.updatedAt})::timestamptz < now() - (${minutes} * interval '1 minute')`;
  const rows = await getDb()
    .select({ id: R.id, ownerEmail: R.ownerEmail, orgId: R.orgId })
    .from(R)
    .where(mode === "spawn" ? and(inArray(R.status, ["queued", "running"]), quiet) : and(eq(R.status, "running"), quiet, sql`${R.attempts} >= 2`))
    .limit(200);
  let closed = 0;
  for (const row of rows) {
    if (ownsRender(row.id)) continue;
    await runWithRequestContext({ userEmail: row.ownerEmail, ...(row.orgId ? { orgId: row.orgId } : {}) }, () =>
      getDb()
        .update(R)
        .set({ status: "failed", error: "The export was interrupted before it finished (the server restarted). Export the video again.", updatedAt: new Date().toISOString() })
        .where(and(eq(R.id, row.id), inArray(R.status, ["queued", "running"]))),
    );
    closed += 1;
  }
  return closed;
}

export function cancelRender(renderId: string): boolean {
  const queued = waiting.findIndex((job) => job.renderId === renderId);
  if (queued >= 0) {
    waiting.splice(queued, 1);
    return true;
  }
  const child = running.get(renderId);
  if (!child) return false;
  cancelled.add(renderId);
  child.kill();
  return true;
}

/** Finished exports kept per video; older ones are removed (a post that was published keeps its export). */
const KEEP_EXPORTS_PER_VIDEO = Math.max(1, Number(process.env.CREWCUT_KEEP_EXPORTS ?? 5));

/**
 * Removes exports nobody can reach any more: all but the newest few finished
 * exports of each video (the export dialog lists four), and the rows of
 * exports that failed or were stopped more than a week ago. Without this,
 * every export ever made stayed in storage for good.
 */
export async function pruneOldRenders(): Promise<number> {
  const result = (await getDb().execute(sql`
    select id, output_file, owner_email, org_id from (
      select id, output_file, owner_email, org_id, status, created_at,
             row_number() over (partition by video_id, status order by created_at desc, id desc) as position
        from render_jobs
       where status in ('done', 'failed', 'cancelled')
    ) ranked
    where ((status = 'done' and position > ${KEEP_EXPORTS_PER_VIDEO})
        or (status <> 'done' and (created_at)::timestamptz < now() - interval '7 days'))
      and not exists (select 1 from publish_jobs p where p.render_job_id = ranked.id)
    limit 100`)) as unknown;
  const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{ id: string; output_file: string | null; owner_email: string; org_id: string | null }>;
  // Imported here: blob-store imports nothing from this file, but keeps the module graph one-way at load.
  const { removeFile } = await import("./blob-store.js");
  for (const row of rows) {
    await runWithRequestContext({ userEmail: row.owner_email, ...(row.org_id ? { orgId: row.org_id } : {}) }, async () => {
      if (row.output_file) await removeFile("renders", row.output_file);
      await getDb().delete(schema.renderJobs).where(eq(schema.renderJobs.id, row.id));
    });
  }
  return rows.length;
}
