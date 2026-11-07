import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseArgs } from "node:util";

import { type AspectRatio, buildTemplate, getTemplate } from "@crewcut/composition";
import { renderFrame } from "@crewcut/renderer/node";

import { LANDING_TEMPLATES, type LandingTemplate } from "../../studio/app/components/landing/landing-media";
import { LEGAL, LEGAL_PAGES, type LegalSlug } from "../../studio/app/components/landing/legal/legal-info";
import { LEGAL_COVER, OG_SIZE } from "../../studio/app/components/landing/seo";

/**
 * Link-preview covers (Open Graph / X cards, 1200×630) for every public page.
 * Each card is an HTML page screenshotted by headless Chrome, then saved as a
 * JPEG (small enough for every platform, WhatsApp included). Template covers
 * use real frames rendered from the templates with the gallery's photo picks.
 * The alt text for each card lives in apps/studio/app/components/landing/seo.ts:
 * keep the two in step, and bump OG_VERSION there after regenerating.
 *
 *   pnpm --filter @crewcut/render-worker og-images [--only home,template-] [--candidates]
 *
 * --candidates renders a contact sheet of moments per template, for picking FRAME_AT.
 */

const run = promisify(execFile);
const OUT_DIR = path.resolve("../studio/public/og");
const WORK_DIR = path.resolve("storage/og-work");
const FONT = path.resolve("../studio/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2");
const CHROME = process.env.CREWCUT_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

/** The moment (fraction of the template's length, ending excluded) that reads best as a still. */
const FRAME_AT: Record<string, number> = {
  "golden-hour": 0.22,
  "product-drop": 0.3,
  "event-night": 0.3,
  "top-five": 0.52,
  "kinetic-quote": 0.45,
  "brand-reveal": 0.6,
};

/** The four templates the gallery cover fans out (named in OG_TEMPLATES' alt). */
const GALLERY_FAN = ["golden-hour", "product-drop", "event-night", "top-five"];

// ── Frames ──────────────────────────────────────────────────────────────────

const frameCache = new Map<string, string>();

async function templateFrame(template: LandingTemplate, ratio: AspectRatio, at = FRAME_AT[template.id] ?? 0.5, scale = 0.6): Promise<string> {
  const key = `${template.id}-${ratio}-${at}-${scale}`;
  const cached = frameCache.get(key);
  if (cached) return cached;
  const definition = getTemplate(template.id);
  const preview = template.previews[ratio];
  if (!definition || !preview) throw new Error(`No ${template.id} preview in ${ratio}`);
  const composition = buildTemplate(definition, { id: `og-${template.id}`, ratio, values: preview.values });
  const output = path.join(WORK_DIR, "frames", `${key.replace(/[:.]/g, "_")}.png`);
  await renderFrame({ composition, assetUrls: {}, atMs: composition.durationMs * at, outputPath: output, browserExecutable: CHROME, bundleDir: path.resolve("storage/.remotion-bundle"), scale });
  frameCache.set(key, output);
  return output;
}

const fileUrl = (file: string) => pathToFileURL(file).href;

// ── Shared look ─────────────────────────────────────────────────────────────

const MARK = `<svg viewBox="8 8 81 88" aria-hidden="true"><path d="M74.51 29.43 A32 32 0 0 0 18 50" fill="none" stroke="#F5F3EE" stroke-width="17"/><path d="M18 50 A32 32 0 0 0 74.51 70.57" fill="none" stroke="#FF5B2E" stroke-width="17" transform="translate(6 4)"/></svg>`;
const LOCKUP = `<div class="lockup">${MARK}<b>crewcut</b></div>`;
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const BASE_CSS = `
@font-face { font-family: Geist; src: url("${fileUrl(FONT)}") format("woff2"); font-weight: 100 900; font-display: block; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${OG_SIZE.width}px; height: ${OG_SIZE.height}px; overflow: hidden; }
body { position: relative; background: #0d0d0f; color: #f5f3ee; font-family: Geist, sans-serif; -webkit-font-smoothing: antialiased; font-feature-settings: "ss01"; }
.lockup { position: absolute; left: 72px; top: 58px; display: flex; align-items: center; gap: 14px; }
.lockup svg { width: 42px; height: 46px; }
.lockup b { font-size: 34px; font-weight: 620; letter-spacing: -0.045em; line-height: 1; }
.host { position: absolute; right: 72px; top: 70px; font-size: 20px; color: #a6a6ae; letter-spacing: -0.01em; }
.cut { color: #ff5b2e; }
h1 { font-weight: 650; letter-spacing: -0.038em; line-height: 1; }
.lede { color: #a6a6ae; font-size: 26px; line-height: 1.38; letter-spacing: -0.012em; }
.pill { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 18px; border-radius: 999px; box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.2); font-size: 19px; font-weight: 520; color: #f5f3ee; }
.pill i { width: 8px; height: 8px; border-radius: 50%; background: #3ccf7f; }
.chips { display: flex; gap: 10px; }
.chips span { height: 38px; padding: 0 14px; display: inline-flex; align-items: center; border-radius: 9px; box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.18); font-size: 19px; font-weight: 560; font-variant-numeric: tabular-nums; }
.frame { position: absolute; overflow: hidden; background: #1c1c21; box-shadow: 0 0 0 1px rgb(255 255 255 / 0.1), 0 28px 60px rgb(0 0 0 / 0.55); }
.frame img { display: block; width: 100%; height: 100%; object-fit: cover; }
`;

const page = (css: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`;

// ── Cards ───────────────────────────────────────────────────────────────────

const CREW: Array<{ name: string; gate?: string }> = [
  { name: "Ideas", gate: "You pick" },
  { name: "Research" },
  { name: "Script", gate: "You approve" },
  { name: "Fact-check", gate: "You approve" },
  { name: "Edit", gate: "You approve" },
  { name: "Voice" },
  { name: "Publish", gate: "You publish" },
  { name: "Results" },
];

function homeCard(): string {
  const LIT = 3;
  const css = `
.badge { position: absolute; right: 72px; top: 61px; }
h1 { position: absolute; left: 72px; top: 156px; font-size: 82px; }
h1 .cut { display: inline-block; margin-left: 0.42em; }
.track { position: absolute; left: 72px; right: 72px; top: 398px; }
.ruler { display: flex; justify-content: space-between; height: 26px; font-size: 14px; color: #6e6e76; font-variant-numeric: tabular-nums; border-bottom: 1px solid rgb(255 255 255 / 0.1); }
.ruler span { position: relative; width: 0; white-space: nowrap; }
.ruler span::after { content: ""; position: absolute; left: 0; top: 19px; width: 1px; height: 7px; background: rgb(255 255 255 / 0.22); }
.lane { position: relative; display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; margin-top: 12px; height: 132px; }
.clip { display: flex; flex-direction: column; padding: 13px 13px 12px; border-radius: 12px; background: #1c1c21; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.07); }
.num { font-size: 14px; color: #8a8a92; font-variant-numeric: tabular-nums; }
.name { margin-top: 5px; font-size: 19px; font-weight: 600; letter-spacing: -0.02em; white-space: nowrap; }
.gate { margin-top: auto; align-self: flex-start; padding: 4px 9px; border-radius: 999px; background: rgb(255 91 46 / 0.14); color: #ff7a54; font-size: 13px; font-weight: 600; white-space: nowrap; }
.clip.lit { background: #ff5b2e; color: #0d0d0f; box-shadow: none; }
.clip.lit .num { color: rgb(13 13 15 / 0.65); }
.clip.lit .gate { background: rgb(13 13 15 / 0.14); color: #0d0d0f; }
.playhead { position: absolute; top: -50px; bottom: -6px; width: 2px; margin-left: -1px; background: #f5f3ee; left: calc((100% - 56px) / 8 * ${LIT + 1} + 8px * ${LIT} + 4px); }
.playhead::before { content: ""; position: absolute; left: -7px; top: 0; width: 16px; height: 18px; background: #f5f3ee; clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%); }
`;
  const clips = CREW.map(
    (step, index) =>
      `<div class="clip${index === LIT ? " lit" : ""}"><span class="num">${index + 1}</span><span class="name">${esc(step.name)}</span>${step.gate ? `<span class="gate">${esc(step.gate)}</span>` : ""}</div>`,
  ).join("");
  const ruler = Array.from({ length: 9 }, (_, index) => `<span>0:${String(index * 5).padStart(2, "0")}</span>`).join("");
  return page(
    css,
    `${LOCKUP}<span class="pill badge"><i></i>Free while in beta</span>
<h1>The video editor for you<br><span class="cut">and your AI crew.</span></h1>
<div class="track"><div class="ruler">${ruler}</div><div class="lane">${clips}<span class="playhead"></span></div></div>`,
  );
}

async function templatesCard(): Promise<string> {
  const picks = GALLERY_FAN.map((id) => LANDING_TEMPLATES.find((entry) => entry.id === id)!);
  const frames = await Promise.all(picks.map((template) => templateFrame(template, "9:16")));
  const css = `
h1 { position: absolute; left: 72px; top: 178px; font-size: 64px; }
.lede { position: absolute; left: 72px; top: 336px; width: 470px; }
.chips { position: absolute; left: 72px; top: 470px; }
.frame { width: 208px; height: 370px; border-radius: 18px; }
`;
  const layout = [
    { left: 628, top: 150, rotate: -6 },
    { left: 762, top: 92, rotate: -2 },
    { left: 896, top: 128, rotate: 2.5 },
    { left: 1030, top: 74, rotate: 6 },
  ];
  const fan = frames.map((frame, index) => `<div class="frame" style="left:${layout[index]!.left}px;top:${layout[index]!.top}px;transform:rotate(${layout[index]!.rotate}deg);z-index:${index}"><img src="${fileUrl(frame)}"></div>`).join("");
  return page(
    css,
    `${LOCKUP}<h1>Pick a template.<br><span class="cut">Make it yours.</span></h1>
<p class="lede">Drop in your photos and words. The motion and music are already done.</p>
<div class="chips"><span>9:16</span><span>4:5</span><span>1:1</span><span>16:9</span></div>${fan}`,
  );
}

async function templateCard(template: LandingTemplate): Promise<string> {
  const tall = await templateFrame(template, "9:16");
  const second = (["1:1", "16:9", "4:5"] as AspectRatio[]).find((ratio) => template.ratios.includes(ratio) && template.previews[ratio]);
  const back = second ? await templateFrame(template, second, FRAME_AT[template.id], 0.4) : null;
  const backSize = second === "16:9" ? { width: 330, height: 186 } : second === "4:5" ? { width: 240, height: 300 } : { width: 260, height: 260 };
  const css = `
.text { position: absolute; left: 72px; top: 164px; width: 530px; display: flex; flex-direction: column; align-items: flex-start; gap: 18px; }
.cat { display: inline-flex; height: 36px; align-items: center; padding: 0 14px; border-radius: 999px; background: rgb(255 91 46 / 0.14); color: #ff7a54; font-size: 18px; font-weight: 600; }
h1 { font-size: 84px; text-wrap: balance; }
.lede { font-size: 23px; line-height: 1.42; text-wrap: pretty; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.chips { position: absolute; left: 72px; bottom: 64px; align-items: center; }
.chips em { margin-left: 10px; font-style: normal; font-size: 19px; color: #a6a6ae; }
.tall { left: 838px; top: 54px; width: 290px; height: 516px; border-radius: 22px; transform: rotate(2deg); z-index: 2; }
.back { left: ${838 - backSize.width + 70}px; top: ${560 - backSize.height}px; width: ${backSize.width}px; height: ${backSize.height}px; border-radius: 16px; transform: rotate(-5deg); z-index: 1; }
.bar { position: absolute; left: 18px; right: 18px; bottom: 18px; height: 4px; border-radius: 4px; background: rgb(255 255 255 / 0.3); }
.bar::before { content: ""; position: absolute; inset: 0 62% 0 0; border-radius: 4px; background: #ff5b2e; }
.play { position: absolute; left: 790px; top: 420px; z-index: 3; width: 84px; height: 84px; border-radius: 50%; background: #ff5b2e; box-shadow: 0 14px 34px rgb(0 0 0 / 0.45); }
.play::after { content: ""; position: absolute; left: 33px; top: 26px; border-left: 26px solid #0d0d0f; border-top: 16px solid transparent; border-bottom: 16px solid transparent; }
`;
  return page(
    css,
    `${LOCKUP}<div class="text"><span class="cat">${esc(template.category)}</span>
<h1>${esc(template.name)}</h1>
<p class="lede">${esc(template.description)}</p></div>
<div class="chips">${template.ratios.map((ratio) => `<span>${ratio}</span>`).join("")}<em>Free template</em></div>
${back ? `<div class="frame back"><img src="${fileUrl(back)}"></div>` : ""}
<div class="frame tall"><img src="${fileUrl(tall)}"><span class="bar"></span></div><span class="play"></span>`,
  );
}

function legalCard(slug: LegalSlug): string {
  const doc = LEGAL_PAGES.find((entry) => entry.slug === slug)!;
  const cover = LEGAL_COVER[slug];
  const css = `
.text { position: absolute; left: 72px; top: 178px; width: 580px; display: flex; flex-direction: column; gap: 28px; }
h1 { font-size: 84px; text-wrap: balance; }
.lede { width: 520px; }
.receipt { position: absolute; right: 92px; top: 58px; width: 380px; padding: 30px 30px 54px; background: #f5f3ee; color: #0d0d0f; transform: rotate(2.5deg); box-shadow: 0 30px 70px rgb(0 0 0 / 0.55);
  -webkit-mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 22px 100%; }
.r-head { display: flex; align-items: center; gap: 10px; font-size: 21px; font-weight: 650; letter-spacing: -0.02em; }
.r-head svg { width: 22px; height: 24px; }
.r-head svg path:first-child { stroke: #0d0d0f; }
.r-meta { margin-top: 6px; font-size: 15px; color: #4a4c54; }
.r-rule { margin: 18px 0; border-top: 2px dashed rgb(13 13 15 / 0.25); }
.r-row { display: flex; align-items: baseline; gap: 10px; padding: 7px 0; font-size: 18px; letter-spacing: -0.01em; }
.r-row b { flex: none; width: 32px; font-weight: 600; color: #c93c0d; font-variant-numeric: tabular-nums; }
.r-row span { flex: 1; }
.r-foot { font-size: 15px; color: #4a4c54; line-height: 1.5; }
.r-foot strong { display: block; color: #0d0d0f; font-weight: 600; }
`;
  const rows = cover.receipt.map(([number, title]) => `<div class="r-row"><b>§${number}</b><span>${esc(title)}</span></div>`).join("");
  return page(
    css,
    `${LOCKUP}<div class="text"><h1>${esc(doc.title)}</h1><p class="lede">${esc(cover.line)}</p></div>
<div class="receipt"><div class="r-head">${MARK}${esc(doc.title)}</div><div class="r-meta">${esc(LEGAL.host)}${esc(doc.href)}</div>
<div class="r-rule"></div>${rows}<div class="r-rule"></div>
<p class="r-foot"><strong>Questions? A person answers.</strong>${esc(LEGAL.email)}</p></div>`,
  );
}

async function watchCard(): Promise<string> {
  const golden = LANDING_TEMPLATES.find((entry) => entry.id === "golden-hour")!;
  const still = await templateFrame(golden, "16:9", 0.12, 0.5);
  const css = `
h1 { position: absolute; left: 72px; top: 180px; font-size: 60px; }
.lede { position: absolute; left: 72px; top: 330px; width: 440px; }
.screen { left: 628px; top: 140px; width: 500px; height: 281px; border-radius: 18px; }
.screen img { filter: brightness(0.62) saturate(0.95); }
.play { position: absolute; left: 50%; top: 50%; width: 104px; height: 104px; margin: -52px 0 0 -52px; border-radius: 50%; background: #ff5b2e; box-shadow: 0 16px 40px rgb(0 0 0 / 0.45); }
.play::after { content: ""; position: absolute; left: 41px; top: 32px; border-left: 32px solid #0d0d0f; border-top: 20px solid transparent; border-bottom: 20px solid transparent; }
.scrub { position: absolute; left: 628px; width: 500px; top: 452px; }
.scrub-track { position: relative; height: 6px; border-radius: 6px; background: rgb(255 255 255 / 0.16); }
.scrub-track::before { content: ""; position: absolute; inset: 0 64% 0 0; border-radius: 6px; background: #ff5b2e; }
.scrub-track::after { content: ""; position: absolute; left: 36%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; background: #f5f3ee; }
.scrub-time { display: flex; justify-content: space-between; margin-top: 14px; font-size: 17px; color: #8a8a92; font-variant-numeric: tabular-nums; }
`;
  return page(
    css,
    `${LOCKUP}<span class="host">View only · no sign-in</span>
<h1>Watch the video.<br><span class="cut">Made in Crewcut.</span></h1>
<p class="lede">Shared from the video editor for you and your AI crew.</p>
<div class="frame screen"><img src="${fileUrl(still)}"><span class="play"></span></div>
<div class="scrub"><div class="scrub-track"></div><div class="scrub-time"><span>0:11</span><span>0:30</span></div></div>`,
  );
}

// ── Output ──────────────────────────────────────────────────────────────────

async function shoot(name: string, html: string): Promise<void> {
  const htmlFile = path.join(WORK_DIR, `${name}.html`);
  const pngFile = path.join(WORK_DIR, `${name}.png`);
  await writeFile(htmlFile, html);
  await run(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${OG_SIZE.width},${OG_SIZE.height}`,
    "--virtual-time-budget=6000",
    "--allow-file-access-from-files",
    `--screenshot=${pngFile}`,
    fileUrl(htmlFile),
  ]);
  const jpgFile = path.join(OUT_DIR, `${name}.jpg`);
  await run(FFMPEG, ["-y", "-loglevel", "error", "-i", pngFile, "-q:v", "2", jpgFile]);
  console.log(`og/${name}.jpg`);
}

async function candidates(): Promise<void> {
  const fractions = [0.12, 0.22, 0.3, 0.38, 0.45, 0.52, 0.6, 0.68, 0.75, 0.85];
  const rows: string[] = [];
  for (const template of LANDING_TEMPLATES) {
    const cells: string[] = [];
    for (const at of fractions) cells.push(`<figure><img src="${fileUrl(await templateFrame(template, "9:16", at, 0.2))}"><figcaption>${at}</figcaption></figure>`);
    rows.push(`<h2>${template.id}</h2><div class="row">${cells.join("")}</div>`);
    process.stdout.write(".");
  }
  const sheet = path.join(WORK_DIR, "candidates.html");
  await writeFile(sheet, `<!doctype html><style>body{background:#111;color:#ddd;font:12px system-ui;margin:12px}h2{margin:10px 0 4px;font-size:13px}.row{display:flex;gap:6px}figure{margin:0}img{height:190px;display:block}</style>${rows.join("")}`);
  console.log(`\nCandidates → ${sheet}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { only: { type: "string" }, candidates: { type: "boolean" } } });
  await mkdir(path.join(WORK_DIR, "frames"), { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });
  if (values.candidates) return candidates();

  const jobs: Array<[string, () => string | Promise<string>]> = [
    ["home", homeCard],
    ["templates", templatesCard],
    ["watch", watchCard],
    ...LEGAL_PAGES.map((doc): [string, () => string] => [doc.slug, () => legalCard(doc.slug)]),
    ...LANDING_TEMPLATES.map((template): [string, () => Promise<string>] => [`template-${template.id}`, () => templateCard(template)]),
  ];
  const only = values.only?.split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const [name, build] of jobs.filter(([name]) => !only || only.some((prefix) => name.startsWith(prefix)))) {
    await shoot(name, await build());
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
