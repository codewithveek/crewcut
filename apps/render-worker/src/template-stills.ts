import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { type AspectRatio, FRAME_SIZE, TEMPLATES, buildTemplate, templateKit } from "@crewcut/composition";
import { renderFrame } from "@crewcut/renderer/node";
import { createStockClient, orientationFor, pickDistinct } from "@crewcut/stock";

/**
 * Template review: renders stills from every template in every ratio it is
 * designed for (scene midpoints plus each scene's entrance) and writes an
 * HTML contact sheet. With PEXELS_API_KEY set, photo slots use the same stock
 * picks the gallery shows; without it, the designed placeholders.
 *
 *   pnpm --filter @crewcut/render-worker template-stills [--template golden-hour] [--ratio 9:16] [--out storage/template-stills]
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { template: { type: "string" }, ratio: { type: "string" }, out: { type: "string" }, scale: { type: "string", default: "0.3" }, browser: { type: "string" } } });
  const outDir = path.resolve(values.out ?? "storage/template-stills");
  const browserExecutable = values.browser ?? process.env.CREWCUT_BROWSER_EXECUTABLE ?? null;
  const bundleDir = path.resolve("storage/.remotion-bundle");
  const stock = process.env.PEXELS_API_KEY ? createStockClient({ apiKey: process.env.PEXELS_API_KEY }) : null;
  const rows: string[] = [];

  for (const template of TEMPLATES.filter((entry) => !values.template || entry.id === values.template)) {
    for (const ratio of template.ratios.filter((entry) => !values.ratio || entry === values.ratio) as AspectRatio[]) {
      const photoSlots = template.slots.filter((slot) => slot.kind === "photo" && !slot.logo);
      const valuesBySlot: Record<string, string> = {};
      if (stock) {
        const { width, height } = FRAME_SIZE[ratio];
        const results = await Promise.all(photoSlots.map((slot) => stock.searchPhotos(slot.default, { orientation: orientationFor(width, height), perPage: 6 }).then((page) => page.photos)));
        pickDistinct(results).forEach((photo, index) => {
          const slot = photoSlots[index];
          if (photo && slot) valuesBySlot[slot.id] = photo.previewUrl;
        });
      }
      const composition = buildTemplate(template, { id: `tpl-${template.id}`, ratio, values: valuesBySlot });
      const kit = templateKit(template, ratio, valuesBySlot);
      const scenes = template.scenes(kit);
      const moments: Array<{ label: string; atMs: number }> = [];
      let cursor = 0;
      scenes.forEach((scene) => {
        const length = kit.beats(scene.beats);
        // Few scenes means long scenes: sample more of each so the motion can be judged.
        const points = scenes.length <= 2 ? [0.08, 0.3, 0.55, 0.85] : [Math.min(250, length / 4) / length, 0.62];
        for (const point of points) moments.push({ label: `${scene.name} · ${Math.round(point * 100)}%`, atMs: cursor + length * point });
        cursor += length;
      });
      const cells: string[] = [];
      for (const [index, moment] of moments.entries()) {
        const file = `${template.id}-${ratio.replace(":", "x")}-${String(index).padStart(2, "0")}.png`;
        await renderFrame({ composition, assetUrls: {}, atMs: moment.atMs, outputPath: path.join(outDir, file), browserExecutable, bundleDir, scale: Number(values.scale) });
        cells.push(`<figure><img src="${file}"><figcaption>${moment.label} · ${(moment.atMs / 1000).toFixed(2)}s</figcaption></figure>`);
        process.stdout.write(".");
      }
      rows.push(`<section><h2>${template.name} · ${ratio}</h2><div class="row">${cells.join("")}</div></section>`);
      console.log(` ${template.id} ${ratio}`);
    }
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Template stills</title><style>body{background:#111;color:#ddd;font:12px system-ui;margin:16px}h2{font-size:14px;margin:18px 0 8px}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}figure{margin:0}img{display:block;max-height:300px;border-radius:4px}figcaption{opacity:.6;margin-top:3px}</style>${rows.join("")}`;
  await writeFile(path.join(outDir, "index.html"), html);
  console.log(`Contact sheet → ${path.join(outDir, "index.html")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
