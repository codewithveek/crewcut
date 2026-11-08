import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { type AspectRatio, parseComposition } from "@crewcut/composition";
import { composeFromScript, demoDossier, demoScript } from "@crewcut/pipeline";
import { RemotionRenderBackend, renderFrame } from "@crewcut/renderer/node";

import { assetUrlMap, startAssetServer } from "./asset-server";

/**
 * One-off renders, no database needed:
 *   pnpm render --demo --ratio 9:16 --out storage/renders/demo.mp4
 *   pnpm render --input composition.json --out out.mp4
 *   pnpm render --demo --still 4200 --out still.png
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      demo: { type: "boolean", default: false },
      input: { type: "string" },
      out: { type: "string" },
      ratio: { type: "string", default: "16:9" },
      seed: { type: "string", default: "3" },
      still: { type: "string" },
      assets: { type: "string" },
      "reduced-motion": { type: "boolean", default: false },
      "no-captions": { type: "boolean", default: false },
      concurrency: { type: "string" },
      browser: { type: "string" },
    },
  });

  let composition;
  if (values.input) {
    composition = parseComposition(JSON.parse(await readFile(values.input, "utf8")));
  } else if (values.demo) {
    composition = composeFromScript({
      videoId: "demo",
      script: demoScript(),
      dossier: demoDossier(new Date().toISOString()),
      ratio: values.ratio as AspectRatio,
      seed: Number(values.seed),
    });
  } else {
    throw new Error("Pass --demo or --input <composition.json>");
  }

  const browserExecutable = values.browser ?? process.env.CREWCUT_BROWSER_EXECUTABLE ?? null;
  const storageRoot = path.resolve(values.assets ?? process.env.CREWCUT_STORAGE_DIR ?? "storage");
  const assetRoot = path.join(storageRoot, "assets");
  const bundleDir = path.join(storageRoot, ".remotion-bundle");
  const server = await startAssetServer(assetRoot);
  // `asset:<id>` references resolve to the matching file in the asset store (`<id>.<ext>`).
  const referenced = new Set([...JSON.stringify(composition).matchAll(/"asset:([A-Za-z0-9_-]+)"/g)].map((match) => match[1] as string));
  const files = referenced.size ? await readdir(assetRoot).catch(() => [] as string[]) : [];
  const missing = [...referenced].filter((id) => !files.some((file) => file.startsWith(`${id}.`)));
  if (missing.length) console.warn(`⚠ ${missing.length} referenced asset(s) not found in ${assetRoot} (they will render blank or silent): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}. Pass --assets <storage dir>.`);
  const assetUrls = assetUrlMap(
    server.baseUrl,
    [...referenced].flatMap((id) => {
      const fileName = files.find((file) => file.startsWith(`${id}.`));
      return fileName ? [{ id, fileName }] : [];
    }),
  );
  try {
    const outputPath = path.resolve(values.out ?? `storage/renders/${composition.id}-${composition.ratio.replace(":", "x")}.${values.still ? "png" : "mp4"}`);
    if (values.still) {
      await renderFrame({ composition, assetUrls, atMs: Number(values.still), outputPath, browserExecutable, bundleDir });
      console.log(`Still → ${outputPath}`);
      return;
    }
    const started = Date.now();
    let lastLogged = -1;
    const result = await new RemotionRenderBackend({ outDir: bundleDir }).render({
      composition,
      assetUrls,
      options: { reducedMotion: values["reduced-motion"], burnCaptions: !values["no-captions"] },
      outputPath,
      browserExecutable,
      concurrency: values.concurrency ? Number(values.concurrency) : null,
      onProgress: ({ fraction, stage }) => {
        const percent = Math.floor(fraction * 100);
        if (percent >= lastLogged + 10) {
          lastLogged = percent;
          console.log(`${stage} ${percent}%`);
        }
      },
    });
    const seconds = (Date.now() - started) / 1000;
    console.log(
      `Rendered ${result.frames} frames (${(result.durationMs / 1000).toFixed(1)} s, ${result.width}×${result.height}) in ${seconds.toFixed(1)} s → ${result.outputPath}`,
    );
  } finally {
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
