import path from "node:path";
import { parseArgs } from "node:util";

import { type AspectRatio, type Composition, buildTemplate, getTemplate, withCrewcutEnding } from "@crewcut/composition";
import { RemotionRenderBackend } from "@crewcut/renderer/node";

import { LANDING_TEMPLATES } from "../../studio/app/components/landing/landing-media";

/**
 * The landing page's videos: real templates rendered to small MP4s so the
 * page plays them with a plain <video> tag (no Remotion, works before the
 * page's scripts load). Same photo picks as the gallery; muted, so no music.
 *
 *   pnpm --filter @crewcut/render-worker landing-videos [--only golden-hour-16x9]
 */
const JOBS: Array<{ template: string; ratio: AspectRatio; out: string }> = [
  { template: "golden-hour", ratio: "16:9", out: "hero-16x9.mp4" },
  { template: "golden-hour", ratio: "9:16", out: "hero-9x16.mp4" },
  { template: "golden-hour", ratio: "1:1", out: "hero-1x1.mp4" },
  { template: "top-five", ratio: "16:9", out: "editor-16x9.mp4" },
];

/** 720 px on the short side: sharp at the size the page shows them, a fraction of the full file size. */
const SHORT_SIDE = 720;

function landingComposition(templateId: string, ratio: AspectRatio): Composition {
  const definition = getTemplate(templateId);
  const preview = LANDING_TEMPLATES.find((entry) => entry.id === templateId)?.previews[ratio];
  if (!definition || !preview) throw new Error(`No ${templateId} preview in ${ratio}`);
  const composition = withCrewcutEnding(buildTemplate(definition, { id: `landing-${templateId}`, ratio, values: preview.values }));
  const scale = SHORT_SIDE / Math.min(composition.width, composition.height);
  return { ...composition, width: Math.round((composition.width * scale) / 2) * 2, height: Math.round((composition.height * scale) / 2) * 2 };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { only: { type: "string" }, out: { type: "string" } } });
  const outDir = path.resolve(values.out ?? "../studio/public/landing");
  const backend = new RemotionRenderBackend({ outDir: path.resolve("storage/.remotion-bundle") });
  for (const job of JOBS.filter((entry) => !values.only || entry.out.startsWith(values.only))) {
    const started = Date.now();
    const result = await backend.render({
      composition: landingComposition(job.template, job.ratio),
      assetUrls: {},
      options: { burnCaptions: false, reducedMotion: false },
      outputPath: path.join(outDir, job.out),
      crf: 27,
      browserExecutable: process.env.CREWCUT_BROWSER_EXECUTABLE ?? null,
    });
    console.log(`${job.out}: ${result.width}×${result.height}, ${(result.durationMs / 1000).toFixed(1)} s, rendered in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
