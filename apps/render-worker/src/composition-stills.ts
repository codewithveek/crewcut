import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { parseComposition } from "@crewcut/composition";
import { renderFrame } from "@crewcut/renderer/node";

import { assetUrlMap, startAssetServer } from "./asset-server";

/**
 * Stills from any composition JSON, tiled into one contact sheet, for checking a
 * design without rendering the video:
 *   pnpm --filter @crewcut/render-worker composition-stills --input comp.json --at 500,2000,4000 --out sheet.jpg
 * `--every 1500` samples the whole video instead of `--at`. `asset:<id>` refs resolve from storage/assets.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { input: { type: "string" }, at: { type: "string" }, every: { type: "string" }, out: { type: "string" }, columns: { type: "string", default: "4" }, width: { type: "string", default: "640" } },
  });
  if (!values.input) throw new Error("Pass --input <composition.json>");
  const composition = parseComposition(JSON.parse(await readFile(values.input, "utf8")));
  const times = values.at
    ? values.at.split(",").map(Number)
    : Array.from({ length: Math.ceil(composition.durationMs / Number(values.every ?? 2000)) }, (_, index) => index * Number(values.every ?? 2000) + 200);
  const storageRoot = path.resolve(process.env.CREWCUT_STORAGE_DIR ?? "../../storage");
  const assetRoot = path.join(storageRoot, "assets");
  const server = await startAssetServer(assetRoot);
  const referenced = [...new Set([...JSON.stringify(composition).matchAll(/"asset:([A-Za-z0-9_-]+)"/g)].map((match) => match[1] as string))];
  const files = await readdir(assetRoot).catch(() => [] as string[]);
  const assetUrls = assetUrlMap(
    server.baseUrl,
    referenced.flatMap((id) => {
      const fileName = files.find((file) => file.startsWith(`${id}.`));
      return fileName ? [{ id, fileName }] : [];
    }),
  );
  const out = path.resolve(values.out ?? "storage/composition-stills/sheet.jpg");
  const tmp = path.join(path.dirname(out), `.stills-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  try {
    for (const [index, atMs] of times.entries()) {
      await renderFrame({
        composition,
        assetUrls,
        atMs,
        outputPath: path.join(tmp, `s${String(index).padStart(3, "0")}.png`),
        browserExecutable: process.env.CREWCUT_BROWSER_EXECUTABLE ?? null,
        bundleDir: path.join(storageRoot, ".remotion-bundle"),
      });
      console.log(`${atMs} ms`);
    }
    const columns = Number(values.columns);
    execFileSync("ffmpeg", [
      "-loglevel", "error", "-y", "-framerate", "1", "-i", path.join(tmp, "s%03d.png"),
      "-vf", `scale=${values.width}:-2,tile=${columns}x${Math.ceil(times.length / columns)}:padding=6:color=0x222222`,
      "-frames:v", "1", "-q:v", "3", out,
    ]);
    console.log(`Contact sheet → ${out}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
