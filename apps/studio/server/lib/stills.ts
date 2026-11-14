import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";

import type { Composition } from "@crewcut/composition";

import { UserError } from "./errors.js";
import { toJson } from "./json.js";
import { renderAssetFiles } from "./render-runner.js";
import { STORAGE_DIR, WORKSPACE_ROOT, newId, writeStorageFile } from "./storage.js";

/**
 * Still pictures (thumbnails), rendered by the render worker in a process of
 * its own, like exports in spawn mode, but outside the export queue: a still
 * takes seconds and shouldn't wait behind, or show up as, an export. One at a
 * time, so a burst of requests can't start many browsers at once.
 */

const TIMEOUT_MS = 3 * 60 * 1000;
let chain: Promise<unknown> = Promise.resolve();

function workerMain(): string {
  return path.join(WORKSPACE_ROOT, "apps", "render-worker", "src", "main.ts");
}

function runWorker(jobFile: string): Promise<{ bytes: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", workerMain(), "--still-file", jobFile], {
      cwd: path.join(WORKSPACE_ROOT, "apps", "render-worker"),
      env: { ...process.env, CREWCUT_STORAGE_DIR: STORAGE_DIR },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let buffer = "";
    let stderr = "";
    let result: { bytes: number; width: number; height: number } | null = null;
    let failure: string | null = null;
    const timer = setTimeout(() => {
      failure = "The picture took too long to render.";
      child.kill();
    }, TIMEOUT_MS);
    timer.unref?.();
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.startsWith("{")) continue;
        try {
          const message = JSON.parse(line) as { type?: string; bytes?: number; width?: number; height?: number; error?: string };
          if (message.type === "done") result = { bytes: message.bytes ?? 0, width: message.width ?? 0, height: message.height ?? 0 };
          if (message.type === "failed") failure = message.error ?? "Rendering failed.";
        } catch {
          // Not a message line.
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", () => {
      clearTimeout(timer);
      if (result && !failure) resolve(result);
      else {
        if (stderr.trim()) console.error(`[still] worker said: ${stderr.trim().slice(-800)}`);
        reject(new Error(failure ?? "The renderer stopped before finishing the picture."));
      }
    });
  });
}

/**
 * Renders the frame at `atMs` of `composition` (already the thumbnail's
 * composition) to storage/renders/<fileName>. Throws UserError with a reason
 * people can read.
 */
export async function renderStillPicture(input: { video: { id: string; ownerEmail: string }; composition: Composition; atMs: number; fileName: string; maxSide?: number }): Promise<{ bytes: number; width: number; height: number }> {
  if (!/^[A-Za-z0-9._-]+\.jpg$/.test(input.fileName)) throw new Error(`Unsafe still file name "${input.fileName}"`);
  if (!existsSync(workerMain())) throw new UserError("Pictures can't be rendered on this server (the renderer isn't installed here).");
  const assetFiles = await renderAssetFiles(input.video, input.composition);
  const jobId = newId("still");
  const job = async () => {
    const jobFile = await writeStorageFile("jobs", `${jobId}.json`, toJson({ jobId, composition: input.composition, assetFiles, atMs: input.atMs, maxSide: input.maxSide ?? 1280, outputFileName: input.fileName }));
    try {
      return await runWorker(jobFile);
    } catch (error) {
      console.error(`[still ${jobId}]`, error instanceof Error ? error.message : error);
      throw new UserError(`The thumbnail couldn't be rendered: ${error instanceof Error ? error.message : "unknown error"}`.slice(0, 300));
    } finally {
      await unlink(jobFile).catch(() => undefined);
    }
  };
  const run = chain.then(job, job);
  chain = run.catch(() => undefined);
  return run;
}
