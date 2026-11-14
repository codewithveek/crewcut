import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Composition } from "@crewcut/composition";

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

/** Packages whose source goes into the bundle (the renderer and what it imports from the workspace). */
const BUNDLED_PACKAGES = ["renderer", "composition", "motion"];

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : filesUnder(full);
      return /\.test\.[cm]?[jt]sx?$/.test(entry.name) ? [] : [full];
    }),
  );
  return nested.flat().sort();
}

/**
 * A name for the bundle built from the current code: a hash of the bundled
 * packages' sources and the lockfile (dependency versions). Same code, same
 * name, so every export after the first reuses the bundle on disk instead of
 * running webpack again; changed code gets a fresh bundle, never a stale one.
 */
async function bundleCodeHash(): Promise<string> {
  const packagesDir = path.resolve(path.dirname(rendererEntryPoint()), "..", "..");
  const files = [
    ...(await Promise.all(BUNDLED_PACKAGES.map((name) => filesUnder(path.join(packagesDir, name, "src"))))).flat(),
    ...BUNDLED_PACKAGES.map((name) => path.join(packagesDir, name, "package.json")),
    path.join(packagesDir, "..", "pnpm-lock.yaml"),
  ];
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = await readFile(file).catch(() => null);
    if (!bytes) continue;
    hash.update(path.relative(packagesDir, file).replaceAll("\\", "/")).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

const BUNDLE_DIR = /^b-[0-9a-f]{16}$/;
const BUNDLE_TMP_DIR = /^b-[0-9a-f]{16}\.tmp-/;

/** Bundles from older code, and half-built ones left by a crashed worker over an hour ago. */
async function removeOldBundles(root: string, keep: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const hourAgo = Date.now() - 60 * 60_000;
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== keep && (BUNDLE_DIR.test(entry.name) || BUNDLE_TMP_DIR.test(entry.name)))
      .map(async (entry) => {
        const full = path.join(root, entry.name);
        if (BUNDLE_TMP_DIR.test(entry.name) && (await stat(full)).mtimeMs > hourAgo) return; // Another worker may be building it.
        await rm(full, { recursive: true, force: true }).catch(() => undefined);
      }),
  );
}

/**
 * Bundles the Remotion project once per code version and reuses it ("bundle
 * once, render many"), across worker processes too. With an `outDir`, bundles
 * live in `<outDir>/b-<code hash>/`: each is built in its own temporary folder
 * and renamed into place, so two exports started together never write into
 * the same folder.
 */
export function bundleRenderer(options: { outDir?: string; onProgress?: (fraction: number) => void } = {}): Promise<string> {
  const key = options.outDir ?? "default";
  let promise = bundles.get(key);
  if (!promise) {
    promise = (async () => {
      // Webpack loads only when a bundle has to be built (importing it alone takes seconds).
      const build = async (outDir?: string) => {
        const { bundle } = await import("@remotion/bundler");
        return bundle({ entryPoint: rendererEntryPoint(), ...(outDir ? { outDir } : {}), onProgress: (percent) => options.onProgress?.(percent / 100) });
      };
      if (!options.outDir) return build();
      const name = `b-${await bundleCodeHash()}`;
      const target = path.join(options.outDir, name);
      if (existsSync(path.join(target, "index.html"))) {
        options.onProgress?.(1);
        return target;
      }
      await mkdir(options.outDir, { recursive: true });
      const temporary = path.join(options.outDir, `${name}.tmp-${process.pid}-${Date.now()}`);
      await build(temporary);
      try {
        await rename(temporary, target);
      } catch {
        // Another worker finished the same bundle first: use theirs.
        await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
        if (!existsSync(path.join(target, "index.html"))) throw new Error(`Could not store the render bundle in ${target}`);
      }
      void removeOldBundles(options.outDir, name);
      return target;
    })();
    promise.catch(() => bundles.delete(key));
    bundles.set(key, promise);
  }
  return promise;
}

/**
 * Browser tabs rendering frames at once: CREWCUT_RENDER_CONCURRENCY, else
 * Remotion's default (half the CPUs). Measured 2026-11-08 on 8 logical CPUs:
 * 8 tabs were no faster than 4 (frames are CPU-bound), so the default stays;
 * try 2 on a 2-CPU server and compare the logged timings.
 */
export function defaultRenderConcurrency(): number | null {
  const configured = Number(process.env.CREWCUT_RENDER_CONCURRENCY);
  if (!Number.isFinite(configured) || configured < 1) return null;
  return Math.min(Math.floor(configured), availableParallelism());
}

type X264Preset = "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow";
/**
 * x264 preset: CREWCUT_X264_PRESET, else "medium". Measured 2026-11-08:
 * "veryfast" saved no time (encoding runs alongside frame rendering, which
 * dominates) and made files ~7% larger, so it is opt-in for CPU-starved servers.
 */
function x264Preset(): X264Preset {
  const value = process.env.CREWCUT_X264_PRESET;
  const allowed: readonly string[] = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"];
  return value && allowed.includes(value) ? (value as X264Preset) : "medium";
}

type RemotionLogLevel = "error" | "warn" | "info" | "verbose";
/** CREWCUT_RENDER_LOG_LEVEL=verbose prints Remotion's own timings (bundling, frames, encoding, slowest frames). */
function renderLogLevel(): RemotionLogLevel {
  const value = process.env.CREWCUT_RENDER_LOG_LEVEL;
  return value === "warn" || value === "info" || value === "verbose" ? value : "error";
}

export class RemotionRenderBackend implements RenderBackend {
  readonly id = "remotion";
  constructor(private readonly bundleOptions: { outDir?: string } = {}) {}

  async render(request: RenderRequest): Promise<RenderResult> {
    const { renderMedia, selectComposition, makeCancelSignal, openBrowser } = await import("@remotion/renderer");
    const logLevel = renderLogLevel();
    const startedAt = Date.now();
    request.onProgress?.({ fraction: 0, stage: "bundling" });
    // Chrome starts while the bundle is found or built, and serves both steps below (it used to start twice).
    const browserPromise = openBrowser("chrome", { browserExecutable: request.browserExecutable ?? null, logLevel });
    browserPromise.catch(() => undefined);
    let serveUrl: string;
    try {
      serveUrl = await bundleRenderer({
        ...this.bundleOptions,
        onProgress: (fraction) => request.onProgress?.({ fraction: fraction * 0.1, stage: "bundling" }),
      });
    } catch (error) {
      await browserPromise.then((browser) => browser.close({ silent: true })).catch(() => undefined);
      throw error;
    }
    const bundledAt = Date.now();
    const browser = await browserPromise;
    const inputProps = { composition: request.composition, assetUrls: request.assetUrls, options: request.options ?? {} };
    let composition: Awaited<ReturnType<typeof selectComposition>>;
    try {
      composition = await selectComposition({
        serveUrl,
        id: VIDEO_COMPOSITION_ID,
        inputProps,
        browserExecutable: request.browserExecutable ?? null,
        puppeteerInstance: browser,
        logLevel,
      });
      await mkdir(path.dirname(request.outputPath), { recursive: true });
      const cancel = makeCancelSignal();
      request.signal?.addEventListener("abort", () => cancel.cancel());
      const framesFrom = Date.now();
      const result = await renderMedia({
        serveUrl,
        composition,
        inputProps,
        codec: "h264",
        audioCodec: "aac",
        pixelFormat: "yuv420p",
        crf: request.crf ?? 18,
        x264Preset: x264Preset(),
        outputLocation: request.outputPath,
        browserExecutable: request.browserExecutable ?? null,
        puppeteerInstance: browser,
        concurrency: request.concurrency ?? defaultRenderConcurrency(),
        // Bounded so a long video export can't take the memory the web app needs (default: half of RAM).
        offthreadVideoCacheSizeInBytes: 1024 ** 3,
        // Remote media can be slow to arrive: wait longer before failing a frame.
        timeoutInMilliseconds: 90_000,
        cancelSignal: cancel.cancelSignal,
        logLevel,
        onProgress: ({ progress, stitchStage }) =>
          request.onProgress?.({ fraction: 0.1 + progress * 0.9, stage: stitchStage === "muxing" ? "encoding" : "rendering" }),
      });
      if (logLevel !== "error") {
        const slowest = result.slowestFrames.slice(0, 5).map((frame) => `${frame.frame}:${Math.round(frame.time)}ms`).join(" ");
        console.error(`[render] bundle ${bundledAt - startedAt} ms, frames+encode ${Date.now() - framesFrom} ms, total ${Date.now() - startedAt} ms; slowest frames ${slowest}`);
      }
    } finally {
      await browser.close({ silent: true }).catch(() => undefined);
    }
    return {
      outputPath: request.outputPath,
      durationMs: request.composition.durationMs,
      frames: composition.durationInFrames,
      width: composition.width,
      height: composition.height,
    };
  }
}

/** Renders one frame to PNG, or JPEG (thumbnails and QA stills at transition midpoints). */
export async function renderFrame(request: {
  composition: Composition;
  assetUrls: Record<string, string>;
  atMs: number;
  outputPath: string;
  browserExecutable?: string | null;
  bundleDir?: string;
  /** Output scale (0.25 = quarter size): contact sheets and thumbnails. */
  scale?: number;
  /** Default png. */
  imageFormat?: "png" | "jpeg";
  /** 1–100, JPEG only (default 88). */
  jpegQuality?: number;
  /** Render options, e.g. { burnCaptions: false }. */
  options?: Record<string, unknown>;
}): Promise<string> {
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await bundleRenderer(request.bundleDir ? { outDir: request.bundleDir } : {});
  const inputProps = { composition: request.composition, assetUrls: request.assetUrls, options: request.options ?? {} };
  const composition = await selectComposition({ serveUrl, id: VIDEO_COMPOSITION_ID, inputProps, browserExecutable: request.browserExecutable ?? null, logLevel: "error" });
  await mkdir(path.dirname(request.outputPath), { recursive: true });
  await renderStill({
    serveUrl,
    composition,
    inputProps,
    frame: Math.min(composition.durationInFrames - 1, Math.max(0, Math.round((request.atMs / 1000) * composition.fps))),
    output: request.outputPath,
    imageFormat: request.imageFormat ?? "png",
    ...(request.imageFormat === "jpeg" ? { jpegQuality: Math.min(100, Math.max(1, Math.round(request.jpegQuality ?? 88))) } : {}),
    ...(request.scale ? { scale: request.scale } : {}),
    browserExecutable: request.browserExecutable ?? null,
    logLevel: "error",
  });
  return request.outputPath;
}
