import { spawn } from "node:child_process";
import path from "node:path";

import { type Composition, iterateLayers } from "@crewcut/composition";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
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

export interface QueueRenderInput {
  video: VideoRecord;
  composition: Composition;
  compositionVersion: number;
  reducedMotion: boolean;
  burnCaptions: boolean;
}

export async function queueRender(input: QueueRenderInput): Promise<{ renderId: string; mode: RenderMode }> {
  const db = getDb();
  const renderId = newId("rnd");
  const assetIds = referencedAssetIds(input.composition);
  const assets = assetIds.length ? await db.select().from(schema.assets).where(inArray(schema.assets.id, assetIds)) : [];
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
    options: { reducedMotion: input.reducedMotion, burnCaptions: input.burnCaptions },
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
    spawnWorker(renderId, jobFile, { userEmail: input.video.row.ownerEmail, orgId: input.video.row.orgId });
  }
  return { renderId, mode };
}

const running = new Map<string, ReturnType<typeof spawn>>();

type JobPatch = Partial<typeof schema.renderJobs.$inferInsert>;

/**
 * Progress arrives after the request that started the render has ended, so
 * each write re-establishes the owner's request context (Agent-Native scopes
 * database work to one). Failures are logged, never swallowed.
 */
function jobWriter(renderId: string, owner: { userEmail: string; orgId: string | null }) {
  let chain: Promise<unknown> = Promise.resolve();
  return (patch: JobPatch) => {
    chain = chain.then(() =>
      Promise.resolve(
        runWithRequestContext({ userEmail: owner.userEmail, ...(owner.orgId ? { orgId: owner.orgId } : {}) }, () =>
          getDb()
            .update(schema.renderJobs)
            .set({ ...patch, updatedAt: new Date().toISOString() })
            .where(eq(schema.renderJobs.id, renderId)),
        ),
      ).catch((error: unknown) => console.error(`[render ${renderId}] could not record progress:`, error)),
    );
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
    if (code !== 0 && !finished) {
      void write({ status: "failed", error: (stderr || `Render worker exited with code ${code}`).slice(-2000) });
    }
  });
  child.on("error", (error) => {
    running.delete(renderId);
    void write({ status: "failed", error: `Couldn't start the render worker: ${error.message}` });
  });
}

export function cancelRender(renderId: string): boolean {
  const child = running.get(renderId);
  if (!child) return false;
  child.kill();
  return true;
}
