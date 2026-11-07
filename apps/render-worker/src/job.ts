import { stat } from "node:fs/promises";
import path from "node:path";

import { type Composition, EXPORT_RESOLUTION_IDS, exportSize, parseComposition } from "@crewcut/composition";
import { RemotionRenderBackend, type RenderResult } from "@crewcut/renderer/node";
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

export async function runRenderJob(payload: RenderJobPayload, options: RunJobOptions): Promise<RenderResult & { bytes: number }> {
  const parsed: Composition = parseComposition(payload.composition);
  // Layouts are % of the frame and design px follow the short side, so a resized frame renders the same picture.
  const composition: Composition = payload.options.resolution ? { ...parsed, ...exportSize(parsed.width, parsed.height, payload.options.resolution) } : parsed;
  const assetRoot = path.resolve(options.storageDir, "assets");
  const outputPath = path.resolve(options.storageDir, "renders", payload.outputFileName);
  const server = await startAssetServer(assetRoot);
  try {
    // One bundle directory under storage, overwritten per render: spawned workers never pile bundles up in the OS temp dir.
    const result = await new RemotionRenderBackend({ outDir: path.resolve(options.storageDir, ".remotion-bundle") }).render({
      composition,
      assetUrls: assetUrlMap(server.baseUrl, payload.assetFiles),
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
