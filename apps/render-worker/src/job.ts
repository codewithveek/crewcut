import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { type Composition, EXPORT_RESOLUTION_IDS, exportSize, parseComposition } from "@crewcut/composition";
import { RemotionRenderBackend, type RenderResult, renderFrame } from "@crewcut/renderer/node";
import { z } from "zod";

import { assetUrlMap, startAssetServer } from "./asset-server";

/** The job payload the studio writes: a composition snapshot plus the asset files it uses. */
export const renderJobPayloadSchema = z.object({
  jobId: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  composition: z.unknown(),
  assetFiles: z.array(z.object({ id: z.string(), fileName: z.string().regex(/^[A-Za-z0-9._-]+$/), url: z.string().url().optional() })).default([]),
  options: z
    .object({
      reducedMotion: z.boolean().default(false),
      burnCaptions: z.boolean().default(true),
      /** Output size named by the short side; missing = the project's own size (1080p). */
      resolution: z.enum(EXPORT_RESOLUTION_IDS).optional(),
    })
    .prefault({}),
  outputFileName: z.string().regex(/^[A-Za-z0-9._-]+\.mp4$/),
});
export type RenderJobPayload = z.infer<typeof renderJobPayloadSchema>;

export interface RunJobOptions {
  storageDir: string;
  onProgress?: (progress: { fraction: number; stage: string }) => void;
  signal?: AbortSignal;
}

type AssetFile = RenderJobPayload["assetFiles"][number];

/**
 * Media the render reads from this machine's disk. Uploads usually already
 * have a local copy (the studio keeps one); remote-only files are downloaded
 * once, before the browser starts, instead of being streamed from the bucket
 * by every render. Files are named by asset id, so a copy never goes stale.
 * A file that can't be downloaded keeps its URL (the browser tries it).
 */
async function localAssetFiles(assetRoot: string, files: readonly AssetFile[]): Promise<AssetFile[]> {
  await mkdir(assetRoot, { recursive: true });
  const queue = [...files];
  const done = new Map<string, AssetFile>();
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const target = path.join(assetRoot, file.fileName);
      const local = await stat(target).then((info) => info.isFile() && info.size > 0).catch(() => false);
      if (local || !file.url) {
        done.set(file.id, { id: file.id, fileName: file.fileName });
        continue;
      }
      const partial = `${target}.part-${process.pid}`;
      try {
        const response = await fetch(file.url, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));
        await rename(partial, target);
        done.set(file.id, { id: file.id, fileName: file.fileName });
      } catch (error) {
        await rm(partial, { force: true }).catch(() => undefined);
        console.error(`[render] couldn't pre-download ${file.fileName}: ${error instanceof Error ? error.message : String(error)}`);
        done.set(file.id, file);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  return files.map((file) => done.get(file.id) ?? file);
}

export async function runRenderJob(payload: RenderJobPayload, options: RunJobOptions): Promise<RenderResult & { bytes: number }> {
  const parsed: Composition = parseComposition(payload.composition);
  // Layouts are % of the frame and design px follow the short side, so a resized frame renders the same picture.
  const composition: Composition = payload.options.resolution ? { ...parsed, ...exportSize(parsed.width, parsed.height, payload.options.resolution) } : parsed;
  const assetRoot = path.resolve(options.storageDir, "assets");
  const outputPath = path.resolve(options.storageDir, "renders", payload.outputFileName);
  options.onProgress?.({ fraction: 0, stage: "downloading" });
  const assetFiles = await localAssetFiles(assetRoot, payload.assetFiles);
  const server = await startAssetServer(assetRoot);
  try {
    // Bundles live under storage, one per code version, reused by every export (spawned workers never pile them up in the OS temp dir).
    const result = await new RemotionRenderBackend({ outDir: path.resolve(options.storageDir, ".remotion-bundle") }).render({
      composition,
      assetUrls: assetUrlMap(server.baseUrl, assetFiles),
      options: { reducedMotion: payload.options.reducedMotion, burnCaptions: payload.options.burnCaptions },
      outputPath,
      browserExecutable: process.env.CREWCUT_BROWSER_EXECUTABLE ?? null,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const info = await stat(outputPath);
    return { ...result, bytes: info.size };
  } finally {
    await server.close();
  }
}

/** A still frame (a thumbnail): one moment of a composition, saved as a JPEG. */
export const stillJobPayloadSchema = z.object({
  jobId: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  composition: z.unknown(),
  assetFiles: z.array(z.object({ id: z.string(), fileName: z.string().regex(/^[A-Za-z0-9._-]+$/), url: z.string().url().optional() })).default([]),
  atMs: z.number().min(0),
  /** Longest side of the picture in px (YouTube thumbnails: 1280). */
  maxSide: z.number().int().min(160).max(3840).default(1280),
  /** Under this many bytes (YouTube: 2 MB): quality steps down until it fits. */
  maxBytes: z.number().int().min(10_000).default(2 * 1024 * 1024),
  outputFileName: z.string().regex(/^[A-Za-z0-9._-]+\.jpg$/),
});
export type StillJobPayload = z.infer<typeof stillJobPayloadSchema>;

export async function runStillJob(payload: StillJobPayload, options: { storageDir: string }): Promise<{ bytes: number; width: number; height: number }> {
  const composition = parseComposition(payload.composition);
  const assetRoot = path.resolve(options.storageDir, "assets");
  const outputPath = path.resolve(options.storageDir, "renders", payload.outputFileName);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const assetFiles = await localAssetFiles(assetRoot, payload.assetFiles);
  const server = await startAssetServer(assetRoot);
  const scale = Math.min(1, payload.maxSide / Math.max(composition.width, composition.height));
  try {
    for (const quality of [88, 75, 60]) {
      await renderFrame({
        composition,
        assetUrls: assetUrlMap(server.baseUrl, assetFiles),
        atMs: payload.atMs,
        outputPath,
        imageFormat: "jpeg",
        jpegQuality: quality,
        scale,
        options: { burnCaptions: false, reducedMotion: false },
        browserExecutable: process.env.CREWCUT_BROWSER_EXECUTABLE ?? null,
        bundleDir: path.resolve(options.storageDir, ".remotion-bundle"),
      });
      const info = await stat(outputPath);
      if (info.size <= payload.maxBytes) return { bytes: info.size, width: Math.round(composition.width * scale), height: Math.round(composition.height * scale) };
    }
    await rm(outputPath, { force: true });
    throw new Error("The picture stays over the size limit even at low quality.");
  } finally {
    await server.close();
  }
}
