import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import postgres from "postgres";

import { type RenderJobPayload, renderJobPayloadSchema, runRenderJob } from "./job";

/**
 * Render worker. Two modes:
 * - queue (production): claims jobs from the Postgres `render_jobs` table with
 *   FOR UPDATE SKIP LOCKED, renders, and writes progress back.
 * - --job-file <path> (local dev, spawned by the studio): renders one job and
 *   prints JSON progress lines on stdout.
 */
const STORAGE_DIR = path.resolve(process.env.PROOFCUT_STORAGE_DIR ?? path.join(process.cwd(), "storage"));
const WORKER_ID = `${os.hostname()}:${process.pid}`;
const POLL_MS = 2000;
const MAX_ATTEMPTS = 2;

function emit(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function runJobFile(filePath: string): Promise<void> {
  const payload = renderJobPayloadSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  let lastFraction = -1;
  try {
    const result = await runRenderJob(payload, {
      storageDir: STORAGE_DIR,
      onProgress: ({ fraction, stage }) => {
        if (fraction - lastFraction >= 0.02 || fraction >= 1) {
          lastFraction = fraction;
          emit({ type: "progress", jobId: payload.jobId, fraction: Math.round(fraction * 1000) / 1000, stage });
        }
      },
    });
    emit({ type: "done", jobId: payload.jobId, outputFileName: payload.outputFileName, bytes: result.bytes, frames: result.frames });
  } catch (error) {
    emit({ type: "failed", jobId: payload.jobId, error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}

async function runQueue(databaseUrl: string): Promise<void> {
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new Error("Queue mode needs a Postgres DATABASE_URL (PGlite is in-process; use spawn mode for local dev).");
  }
  const sql = postgres(databaseUrl, { max: 2 });
  let stopping = false;
  process.on("SIGTERM", () => (stopping = true));
  process.on("SIGINT", () => (stopping = true));
  console.log(`[worker ${WORKER_ID}] polling render_jobs (storage: ${STORAGE_DIR})`);

  while (!stopping) {
    const [job] = await sql<Array<{ id: string; payload: RenderJobPayload; attempts: number }>>`
      UPDATE render_jobs SET status = 'running', locked_by = ${WORKER_ID}, locked_at = now(), attempts = attempts + 1, updated_at = now()
      WHERE id = (
        SELECT id FROM render_jobs
        WHERE status = 'queued' OR (status = 'running' AND locked_at < now() - interval '30 minutes' AND attempts < ${MAX_ATTEMPTS})
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, payload, attempts`;
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      continue;
    }
    console.log(`[worker] job ${job.id} (attempt ${job.attempts})`);
    let lastWrite = 0;
    try {
      const payload = renderJobPayloadSchema.parse(job.payload);
      const result = await runRenderJob(payload, {
        storageDir: STORAGE_DIR,
        onProgress: ({ fraction, stage }) => {
          const now = Date.now();
          if (now - lastWrite < 1000) return;
          lastWrite = now;
          void sql`UPDATE render_jobs SET progress = ${fraction}, stage = ${stage}, updated_at = now() WHERE id = ${job.id}`;
        },
      });
      await sql`UPDATE render_jobs SET status = 'done', progress = 1, stage = 'done', output_file = ${payload.outputFileName}, output_bytes = ${result.bytes}, error = NULL, updated_at = now() WHERE id = ${job.id}`;
      console.log(`[worker] job ${job.id} done (${result.frames} frames)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = job.attempts >= MAX_ATTEMPTS ? "failed" : "queued";
      await sql`UPDATE render_jobs SET status = ${status}, error = ${message.slice(0, 2000)}, updated_at = now() WHERE id = ${job.id}`;
      console.error(`[worker] job ${job.id} ${status}: ${message}`);
    }
  }
  await sql.end();
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { "job-file": { type: "string" } } });
  if (values["job-file"]) {
    await runJobFile(values["job-file"]);
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Set DATABASE_URL (Postgres) or pass --job-file.");
  await runQueue(databaseUrl);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
