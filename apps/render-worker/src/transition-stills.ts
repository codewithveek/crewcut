import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { type AspectRatio, FRAME_SIZE, TEMPLATES, TRANSITION_CATALOG, TRANSITION_TYPES, type TransitionType, buildTemplate, defaultTransition } from "@crewcut/composition";
/** Same id as @crewcut/renderer (its browser entry pulls in font files node cannot load). */
const VIDEO_COMPOSITION_ID = "crewcut-video";
import { bundleRenderer } from "@crewcut/renderer/node";
import { createStockClient, orientationFor, pickDistinct } from "@crewcut/stock";

/**
 * Transition review: renders every transition (or `--only a,b`) at several
 * points of its timeline between two real clips of a template, and writes an
 * HTML contact sheet. One browser for the whole run.
 *
 *   pnpm --filter @crewcut/render-worker transition-stills [--only film-burn,swipe] [--ratio 9:16] [--template golden-hour]
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      only: { type: "string" },
      group: { type: "string" },
      ratio: { type: "string", default: "16:9" },
      template: { type: "string", default: "golden-hour" },
      out: { type: "string" },
      scale: { type: "string", default: "0.25" },
      points: { type: "string", default: "0.15,0.3,0.42,0.5,0.58,0.7,0.85" },
      browser: { type: "string" },
    },
  });
  const outDir = path.resolve(values.out ?? "storage/transition-stills");
  await mkdir(outDir, { recursive: true });
  const ratio = values.ratio as AspectRatio;
  const template = TEMPLATES.find((entry) => entry.id === values.template);
  if (!template) throw new Error(`Unknown template ${values.template}`);

  const stock = process.env.PEXELS_API_KEY ? createStockClient({ apiKey: process.env.PEXELS_API_KEY }) : null;
  const slotValues: Record<string, string> = {};
  if (stock) {
    const { width, height } = FRAME_SIZE[ratio];
    const photoSlots = template.slots.filter((slot) => slot.kind === "photo" && !slot.logo);
    const results = await Promise.all(photoSlots.map((slot) => stock.searchPhotos(slot.default, { orientation: orientationFor(width, height), perPage: 6 }).then((page) => page.photos)));
    pickDistinct(results).forEach((photo, index) => {
      const slot = photoSlots[index];
      if (photo && slot) slotValues[slot.id] = photo.previewUrl;
    });
  }
  const base = buildTemplate(template, { id: `tr-${template.id}`, ratio, values: slotValues });
  const track = base.tracks.find((entry) => entry.kind === "visual");
  if (!track || track.kind !== "visual" || track.clips.length < 2) throw new Error("Template needs two visual clips");
  const target = [...track.clips].sort((a, b) => a.startMs - b.startMs)[1];
  if (!target) throw new Error("No second clip");

  const only = values.only?.split(",").map((entry) => entry.trim());
  const types = (TRANSITION_TYPES as readonly TransitionType[]).filter((type) => type !== "cut" && (!only || only.includes(type)) && (!values.group || TRANSITION_CATALOG[type].group === values.group));
  const points = values.points.split(",").map(Number);

  const { openBrowser, renderStill, selectComposition } = await import("@remotion/renderer");
  const browserExecutable = values.browser ?? process.env.CREWCUT_BROWSER_EXECUTABLE ?? null;
  const serveUrl = await bundleRenderer({ outDir: path.resolve("storage/.remotion-bundle") });
  const browser = await openBrowser("chrome", { browserExecutable });
  const config = await selectComposition({ serveUrl, id: VIDEO_COMPOSITION_ID, inputProps: { composition: base, assetUrls: {}, options: {} }, browserExecutable, puppeteerInstance: browser, logLevel: "error" });

  const rows: string[] = [];
  try {
    for (const type of types) {
      const info = TRANSITION_CATALOG[type];
      const transition = defaultTransition(type);
      const composition = structuredClone(base);
      for (const entry of composition.tracks) {
        if (entry.kind !== "visual") continue;
        for (const clip of entry.clips) if (clip.id === target.id) clip.transitionIn = transition;
      }
      const cells: string[] = [];
      for (const [index, point] of points.entries()) {
        const atMs = target.startMs + transition.durationMs * point;
        const file = `${type}-${ratio.replace(":", "x")}-${index}.jpg`;
        await renderStill({
          serveUrl,
          composition: { ...config, props: { composition, assetUrls: {}, options: {} } },
          inputProps: { composition, assetUrls: {}, options: {} },
          frame: Math.min(config.durationInFrames - 1, Math.round((atMs / 1000) * config.fps)),
          output: path.join(outDir, file),
          imageFormat: "jpeg",
          jpegQuality: 82,
          scale: Number(values.scale),
          puppeteerInstance: browser,
          browserExecutable,
          logLevel: "error",
        });
        cells.push(`<figure><img src="${file}"><figcaption>${Math.round(point * 100)}%</figcaption></figure>`);
      }
      rows.push(`<section><h2>${info.label} <small>${type} · ${info.group} · ${transition.durationMs} ms</small></h2><div class="row">${cells.join("")}</div></section>`);
      console.log(type);
    }
  } finally {
    await browser.close({ silent: true });
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Transition stills</title><style>body{background:#111;color:#ddd;font:12px system-ui;margin:16px}h2{font-size:14px;margin:18px 0 8px}small{opacity:.5;font-weight:400}.row{display:flex;flex-wrap:wrap;gap:6px}figure{margin:0}img{display:block;max-height:200px;border-radius:3px}figcaption{opacity:.6;margin-top:2px}</style>${rows.join("")}`;
  await writeFile(path.join(outDir, "index.html"), html);
  console.log(`Contact sheet → ${path.join(outDir, "index.html")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
