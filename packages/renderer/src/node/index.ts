import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Composition } from "@proofcut/composition";

import type { RenderOptions } from "../context";
import { VIDEO_COMPOSITION_ID } from "../video";

/**
 * Node-only render API (render workers). The renderer is one backend behind
 * validate / preview / render; a HyperFrames backend can implement the same
 * interface later.
 */
export interface RenderBackend {
  readonly id: string;
  render(request: RenderRequest): Promise<RenderResult>;
}

export interface RenderRequest {
  composition: Composition;
  assetUrls: Record<string, string>;
  options?: Partial<RenderOptions>;
  outputPath: string;
  concurrency?: number | null;
  crf?: number;
  browserExecutable?: string | null;
  onProgress?: (progress: { fraction: number; stage: "bundling" | "rendering" | "encoding" }) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  outputPath: string;
  durationMs: number;
  frames: number;
  width: number;
  height: number;
}

const bundles = new Map<string, Promise<string>>();

export function rendererEntryPoint(): string {
  return fileURLToPath(new URL("../remotion-entry.ts", import.meta.url));
}

/** Bundles the Remotion project once per output dir and reuses it ("bundle once, render many"). */
export function bundleRenderer(options: { outDir?: string; onProgress?: (fraction: number) => void } = {}): Promise<string> {
  const key = options.outDir ?? "default";
  let promise = bundles.get(key);
  if (!promise) {
    promise = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({
        entryPoint: rendererEntryPoint(),
        ...(options.outDir ? { outDir: options.outDir } : {}),
        onProgress: (percent) => options.onProgress?.(percent / 100),
      });
    })();
    promise.catch(() => bundles.delete(key));
    bundles.set(key, promise);
  }
  return promise;
}

export class RemotionRenderBackend implements RenderBackend {
  readonly id = "remotion";
  constructor(private readonly bundleOptions: { outDir?: string } = {}) {}

  async render(request: RenderRequest): Promise<RenderResult> {
    const { renderMedia, selectComposition, makeCancelSignal } = await import("@remotion/renderer");
    request.onProgress?.({ fraction: 0, stage: "bundling" });
    const serveUrl = await bundleRenderer({
      ...this.bundleOptions,
      onProgress: (fraction) => request.onProgress?.({ fraction: fraction * 0.1, stage: "bundling" }),
    });
    const inputProps = { composition: request.composition, assetUrls: request.assetUrls, options: request.options ?? {} };
    const composition = await selectComposition({
      serveUrl,
      id: VIDEO_COMPOSITION_ID,
      inputProps,
      browserExecutable: request.browserExecutable ?? null,
      logLevel: "error",
    });
    await mkdir(path.dirname(request.outputPath), { recursive: true });
    const cancel = makeCancelSignal();
    request.signal?.addEventListener("abort", () => cancel.cancel());
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      crf: request.crf ?? 18,
      outputLocation: request.outputPath,
      browserExecutable: request.browserExecutable ?? null,
      concurrency: request.concurrency ?? null,
      cancelSignal: cancel.cancelSignal,
      logLevel: "error",
      onProgress: ({ progress, stitchStage }) =>
        request.onProgress?.({ fraction: 0.1 + progress * 0.9, stage: stitchStage === "muxing" ? "encoding" : "rendering" }),
    });
    return {
      outputPath: request.outputPath,
      durationMs: request.composition.durationMs,
      frames: composition.durationInFrames,
      width: composition.width,
      height: composition.height,
    };
  }
}

/** Renders one frame to PNG (thumbnails and QA stills at transition midpoints). */
export async function renderFrame(request: {
  composition: Composition;
  assetUrls: Record<string, string>;
  atMs: number;
  outputPath: string;
  browserExecutable?: string | null;
  bundleDir?: string;
}): Promise<string> {
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await bundleRenderer(request.bundleDir ? { outDir: request.bundleDir } : {});
  const inputProps = { composition: request.composition, assetUrls: request.assetUrls, options: {} };
  const composition = await selectComposition({ serveUrl, id: VIDEO_COMPOSITION_ID, inputProps, browserExecutable: request.browserExecutable ?? null, logLevel: "error" });
  await mkdir(path.dirname(request.outputPath), { recursive: true });
  await renderStill({
    serveUrl,
    composition,
    inputProps,
    frame: Math.min(composition.durationInFrames - 1, Math.max(0, Math.round((request.atMs / 1000) * composition.fps))),
    output: request.outputPath,
    imageFormat: "png",
    browserExecutable: request.browserExecutable ?? null,
    logLevel: "error",
  });
  return request.outputPath;
}
