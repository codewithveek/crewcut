/**
 * End-to-end check of the Crewcut pipeline through its real actions, against
 * a throwaway PGlite database:
 *   pnpm --filter @crewcut/studio e2e
 *
 * Walks the masterplan's demo: idea → ideas → pick → source → dossier →
 * script → QA flags the unsourced claim → apply its fix → compose → edit on
 * the timeline (trim, split, keyframe, preset) → undo → variety guard →
 * render job → analytics insight, and checks the guarantees on the way:
 * agents can't approve, approvals are logged, every edit is a version.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(os.tmpdir(), "crewcut-e2e-"));
process.env.DATABASE_URL = `pglite:${path.join(scratch, "db")}`;
process.env.CREWCUT_STORAGE_DIR = path.join(scratch, "storage");
process.env.CREWCUT_RENDER_MODE = "queue"; // queue only: don't launch Chromium in the check
process.env.NODE_ENV = "development";
// No network in the check: templates fall back to their designed placeholders and no music.
delete process.env.PEXELS_API_KEY;
delete process.env.ELEVENLABS_API_KEY;

type Ctx = { caller: "frontend" | "tool"; userEmail: string; orgId: null };
const human: Ctx = { caller: "frontend", userEmail: "e2e@crewcut.test", orgId: null };
const agent: Ctx = { caller: "tool", userEmail: "e2e@crewcut.test", orgId: null };

interface ActionModule {
  default: { run: (args: unknown, ctx: Ctx) => Promise<unknown> };
}

let passed = 0;
function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(`✘ ${message}`);
  passed += 1;
  console.log(`✔ ${message}`);
}

async function call<T = Record<string, unknown>>(name: string, args: unknown, ctx: Ctx = agent): Promise<T> {
  const mod = (await import(`../actions/${name}.ts`)) as ActionModule;
  return (await mod.default.run(args, ctx)) as T;
}

async function expectFailure(promise: Promise<unknown>, pattern: RegExp, message: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!pattern.test(text)) console.error(`   (actual error: ${text})`);
    check(pattern.test(text), message);
    return;
  }
  throw new Error(`✘ ${message} (it succeeded)`);
}

async function main(): Promise<void> {
  const migrate = (await import("../server/plugins/db.ts")).default as unknown as () => Promise<void>;
  await migrate();
  const { DEMO_SOURCE, demoDossier, demoIdeas, demoScript } = await import("@crewcut/pipeline");

  // 1. Idea → trend agent's ideas → a person picks one.
  const started = await call<{ videoId: string }>("start-pipeline", { brief: "Why do spring animations feel physical?", ratio: "16:9", platforms: ["youtube"] }, human);
  const videoId = started.videoId;
  await call("find-trends", { videoId, ideas: demoIdeas() });
  let state = await call<{ stages: Record<string, { status: string }> }>("get-video", { videoId }, human);
  check(state.stages.trend?.status === "awaiting_approval", "trend stage waits for a person to pick an idea");
  await expectFailure(call("approve-stage", { videoId, stage: "trend", ideaId: "idea-1" }, agent), /needs a person|signed-in app UI/, "the agent cannot approve its own ideas");
  await call("approve-stage", { videoId, stage: "trend", ideaId: "idea-1" }, human);

  // 2. Research: a real source, facts quoted verbatim and verified mechanically.
  const source = await call<{ sourceId: string; excerpt: string }>("add-source", { videoId, text: DEMO_SOURCE.text, title: DEMO_SOURCE.title, publisher: DEMO_SOURCE.publisher });
  check(source.excerpt.includes("<untrusted-source"), "fetched content comes back wrapped as untrusted data");
  const seeded = demoDossier(new Date().toISOString());
  const facts = seeded.facts.map(({ verified: _verified, locator: _locator, ...fact }) => ({ ...fact, sourceId: source.sourceId }));
  const dossier = await call<{ verified: number; facts: number }>("build-dossier", {
    videoId,
    topic: seeded.topic,
    angle: seeded.angle,
    summary: seeded.summary,
    facts: [...facts, { id: "f9", statement: "Invented", sourceId: source.sourceId, quote: "This sentence is not in the source at all", confidence: "low" }],
  });
  check(dossier.verified === 8 && dossier.facts === 9, "8 quotes verified against the source; the invented one is not");

  // 3. Script with a source on every claim — and one deliberately unsourced line.
  const written = await call<{ audit: { unsupported: number } }>("write-script", { videoId, script: demoScript() });
  check(written.audit.unsupported === 1, "the claim audit flags exactly one unsupported claim");
  await call("approve-stage", { videoId, stage: "script" }, human);
  state = await call("get-video", { videoId }, human);
  check(state.stages.qa?.status === "blocked", "QA blocks on the unsupported claim");
  await expectFailure(call("approve-stage", { videoId, stage: "qa" }, human), /unsupported/, "a blocked QA gate can't be approved");

  // 4. Apply QA's fix.
  const fixes = await call<{ fixes: Array<{ index: number; kind: string }> }>("apply-fix", { videoId, claimId: "claim:l9" });
  const cut = fixes.fixes.find((fix) => fix.kind === "cut");
  check(cut !== undefined, "QA offers concrete fixes, including cutting the line");
  await call("apply-fix", { videoId, claimId: "claim:l9", fixIndex: cut?.index });
  state = await call("get-video", { videoId }, human);
  check(state.stages.qa?.status === "awaiting_approval", "after the fix, QA waits for approval instead of blocking");
  await call("approve-stage", { videoId, stage: "qa" }, human);

  // 5. The motion director composes a freeform video with its own brief.
  const composed = await call<{ version: number; brief: { mood: string } }>("compose-video", { videoId });
  check(composed.version === 1 && composed.brief.mood.length > 0, "composition v1 has an art direction brief");
  const full = await call<{ composition: { tracks: Array<{ id: string; clips: Array<{ id: string; startMs: number; durationMs: number; layers?: Array<{ id: string; type: string }> }> }> } }>("get-composition", { videoId }, human);
  const scene2 = full.composition.tracks[0]?.clips[1];
  if (!scene2) throw new Error("no scene 2");

  // 6. Timeline edits: millisecond trim, split, keyframe, preset — each one version.
  await call("trim-clip", { videoId, clipId: scene2.id, edge: "end", toMs: scene2.startMs + scene2.durationMs - 250, ripple: true }, human);
  await call("split-clip", { videoId, clipId: scene2.id, atMs: scene2.startMs + 1000 }, human);
  const layer = scene2.layers?.find((candidate) => candidate.type === "text") ?? scene2.layers?.[0];
  if (!layer) throw new Error("no layer");
  await call("set-keyframe", { videoId, clipId: scene2.id, layerId: layer.id, property: "x", atMs: 0, value: 40, easing: "spring-smooth" }, human);
  const preset = await call<{ version: number }>("apply-motion-preset", { videoId, clipId: scene2.id, layerIds: [layer.id], presetId: "scale-in" }, human);
  check(preset.version === 5, "trim, split, keyframe and preset each landed as one version (v2–v5)");

  // 7. Ask the agent to "make the hook punchier": one batched, undoable step.
  const punchier = await call<{ version: number; label: string }>("edit-composition", {
    videoId,
    label: "Make the hook punchier",
    ops: [{ op: "apply-motion-preset", clipId: "scene-1", layerIds: [full.composition.tracks[0]?.clips[0]?.layers?.find((l) => l.type === "text")?.id ?? ""], presetId: "pop-in" }],
  });
  check(punchier.version === 6, "the agent's multi-op edit is a single version");
  const undone = await call<{ version: number; restoredFrom: number }>("restore-composition-version", { videoId, version: 5 }, human);
  check(undone.version === 7 && undone.restoredFrom === 5, "undo restores v5 as a new version (history is never rewritten)");
  const history = await call<{ versions: Array<{ label: string; authorKind: string }> }>("get-composition", { videoId }, human);
  check(history.versions.some((entry) => entry.label.startsWith("Agent: Make the hook punchier") && entry.authorKind === "agent"), "agent edits are labelled as the agent's in history");

  // 8. Variety guard, render job, publish gate.
  const variety = await call<{ tooSimilar: boolean; comparisons: unknown[] }>("check-sameness", { videoId }, human);
  check(variety.tooSimilar === false, "the variety guard runs (no look-alikes in a fresh workspace)");
  const render = await call<{ renderId: string; mode: string }>("render-video", { videoId });
  check(render.mode === "queue" && render.renderId.startsWith("rnd_"), "rendering is queued for a separate worker");
  await expectFailure(call("publish-post", { publishJobId: "pub_x" }, agent), /needs a person|signed-in app UI/, "the agent can never publish");

  // 9. Analytics on the seeded sample video, through the demo seed.
  const seed = await call<{ sampleVideoId: string }>("seed-demo", { through: "ideas" }, human);
  const insights = await call<{ insights: Array<{ kind: string; headline: string }> }>("explain-performance", { videoId: seed.sampleVideoId, window: "7d" });
  const drop = insights.insights.find((insight) => insight.kind === "retention-drop");
  check(drop !== undefined && /during the code card/.test(drop.headline), `analytics maps the drop to the frame: "${drop?.headline}"`);

  // 10. The authorship log has every human decision.
  const finalState = await call<{ approvals: Array<{ stage: string; decision: string; actorKind: string }> }>("get-video", { videoId }, human);
  const approvals = finalState.approvals;
  check(
    ["trend", "script", "qa"].every((stage) => approvals.some((event) => event.stage === stage && event.decision === "approved" && event.actorKind === "human")),
    "every gate approval is logged with a human actor",
  );

  // 11. Templates: search the library, start a project with the person's words.
  await checkTemplates();

  // 12. Search and paging run in the database, with counts per filter.
  await checkSearchAndPaging();

  // 13. Remote file storage (R2/S3/Builder) through a fake provider: one index, any backend.
  await checkRemoteStorage();
  console.log(`\nAll ${passed} checks passed.`);
}

async function checkTemplates(): Promise<void> {
  type Listing = { templates: Array<{ id: string; ratios: string[]; slots: Array<{ id: string; kind: string }> }> };
  const all = await call<Listing>("list-templates", {}, human);
  check(all.templates.length >= 3 && all.templates.every((template) => template.slots.length > 0), "the template library lists templates with their slots");
  const portrait = await call<Listing>("list-templates", { ratio: "16:9", query: "quote" }, human);
  check(portrait.templates.length > 0 && portrait.templates.every((template) => template.ratios.includes("16:9")), "template search filters by ratio and words");
  const made = await call<{ videoId: string; path: string; ratio: string; note?: string }>("use-template", { templateId: "product-drop", ratio: "16:9", values: { product: "ORBIT ONE", price: "$89" } }, agent);
  check(made.ratio === "1:1" && Boolean(made.note), "a ratio the template isn't designed for falls back to the closest designed one, and says so");
  const composition = await call<{ composition: { ratio: string; tracks: Array<{ kind: string; clips: Array<{ layers?: Array<{ slot?: string; text?: string; src?: string }> }> }> } }>("get-composition", { videoId: made.videoId }, human);
  const layers = composition.composition.tracks.flatMap((track) => (track.kind === "visual" ? track.clips.flatMap((clip) => clip.layers ?? []) : []));
  check(layers.some((layer) => layer.slot === "product" && layer.text === "ORBIT ONE") && layers.some((layer) => layer.slot === "price" && layer.text === "$89"), "the person's words land in the template's text slots");
  check(layers.filter((layer) => layer.slot?.startsWith("photo")).every((layer) => layer.src?.startsWith("data:image/svg+xml")), "without stock photos, photo slots keep their designed placeholders");
  await expectFailure(call("use-template", { templateId: "golden-hour", ratio: "9:16", values: { headline: "x" } }, human), /no slot "headline"/, "an unknown slot id is refused (no silent typos)");
  await expectFailure(call("generate-template-music", {}, agent), /needs a person/, "the agent can't spend the music allowance");
}

async function checkSearchAndPaging(): Promise<void> {
  type Page = { videos: Array<{ id: string; title: string }>; total: number; counts: Record<string, number>; nextOffset: number | null };
  for (let index = 1; index <= 7; index += 1) {
    await call("create-blank-video", { title: `Paging test ${String(index).padStart(2, "0")}`, ratio: "16:9" }, human);
  }
  await call("create-blank-video", { title: "100% literal_match", ratio: "9:16" }, human);
  const first = await call<Page>("list-videos", { query: "paging test", sort: "title", limit: 3 }, human);
  check(first.total === 7 && first.videos.length === 3 && first.nextOffset === 3, "project search pages on the server (3 of 7, next page at 3)");
  check(first.videos.map((video) => video.title).join() === "Paging test 01,Paging test 02,Paging test 03", "sorting by name is applied before paging");
  const last = await call<Page>("list-videos", { query: "paging test", sort: "title", limit: 3, offset: 6 }, human);
  check(last.videos.length === 1 && last.nextOffset === null, "the last page reports there is nothing after it");
  const drafts = await call<Page>("list-videos", { query: "paging", filter: "drafts", limit: 50 }, human);
  check(drafts.counts.drafts === 7 && drafts.counts.pipeline === 0 && drafts.total === 7, "filter counts follow the search (7 drafts, 0 with agents)");
  const literal = await call<Page>("list-videos", { query: "100%", limit: 50 }, human);
  const underscore = await call<Page>("list-videos", { query: "liter_l", limit: 50 }, human);
  check(literal.total === 1 && underscore.total === 0, "% and _ in a search are literal characters, not wildcards");
  const waiting = await call<Page>("list-videos", { filter: "waiting", limit: 50 }, human);
  check(waiting.videos.every((video) => !video.title.startsWith("Paging")), "blank projects never show as waiting on a person");
  const assets = await call<{ assets: unknown[]; total: number; counts: { image: number; video: number; audio: number } }>("list-assets", { scope: "all", mediaType: "visual", limit: 1 }, human);
  check(assets.assets.length <= 1 && assets.total === assets.counts.image + assets.counts.video, "asset pages carry the total and per-type counts");
  await checkSharedMedia();
}

/** The editor's media panel lists everything the person has; deleting a project keeps media other projects use. */
async function checkSharedMedia(): Promise<void> {
  const { getDb, schema } = await import("../server/db/index.ts");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  const a = await call<{ videoId: string }>("create-blank-video", { title: "Shared media A", ratio: "16:9" }, human);
  const b = await call<{ videoId: string }>("create-blank-video", { title: "Shared media B", ratio: "16:9" }, human);
  const row = (id: string, videoId: string, label: string) => ({ id, videoId, kind: "upload", label, fileName: `${id}.png`, mime: "image/png", bytes: 1, licence: "{}", ownerEmail: human.userEmail, orgId: null });
  await db.insert(schema.assets).values([row("ast_e2e_shared", a.videoId, "Shared beach"), row("ast_e2e_only_a", a.videoId, "Only in A"), row("ast_e2e_b", b.videoId, "B's own")]);
  const listed = await call<{ assets: Array<{ id: string }> }>("list-assets", { scope: "all", videoId: b.videoId, mediaType: "visual", limit: 500 }, human);
  const ids = listed.assets.map((asset) => asset.id);
  check(ids[0] === "ast_e2e_b" && ids.includes("ast_e2e_shared"), "the editor's media lists other projects' media too, this project's first");
  // B starts using A's photo.
  await db.insert(schema.compositions).values({ id: "cmp_e2e_shared", videoId: b.videoId, version: 99, body: JSON.stringify({ layer: { src: "asset:ast_e2e_shared" } }), fingerprint: "x", label: "Use shared photo", authorKind: "human", author: human.userEmail });
  await call("delete-video", { videoId: a.videoId }, human);
  const [kept] = await db.select().from(schema.assets).where(eq(schema.assets.id, "ast_e2e_shared"));
  const [gone] = await db.select().from(schema.assets).where(eq(schema.assets.id, "ast_e2e_only_a"));
  check(kept?.videoId === null && !gone, "deleting a project keeps media another project uses (moved to the library) and removes the rest");
  await db.delete(schema.compositions).where(eq(schema.compositions.id, "cmp_e2e_shared"));
}

async function checkRemoteStorage(): Promise<void> {
  const { registerFileUploadProvider, unregisterFileUploadProvider } = await import("@agent-native/core/file-upload");
  const blob = await import("../server/lib/blob-store.ts");
  const { storagePath, writeStorageFile } = await import("../server/lib/storage.ts");
  const { existsSync } = await import("node:fs");
  const bucket = new Map<string, Uint8Array>();
  registerFileUploadProvider({
    id: "fake-bucket",
    name: "Fake bucket",
    isConfigured: () => true,
    upload: async (input) => {
      const id = `obj-${bucket.size + 1}-${input.filename}`;
      bucket.set(id, new Uint8Array(input.data));
      return { url: `https://cdn.crewcut.test/${id}`, id, provider: "fake-bucket" };
    },
    delete: async (input) => bucket.delete(input.id ?? ""),
  });
  const previous = process.env.CREWCUT_STORAGE;
  try {
    process.env.CREWCUT_STORAGE = "local";
    const local = await blob.putFile("assets", "e2e-local.png", new Uint8Array([1, 2, 3]), "image/png");
    check(local.provider === "local" && bucket.size === 0 && existsSync(storagePath("assets", "e2e-local.png")), "CREWCUT_STORAGE=local keeps files on disk even when a bucket is configured");

    process.env.CREWCUT_STORAGE = "auto";
    const stored = await blob.putFile("assets", "e2e-remote.png", new Uint8Array([4, 5, 6]), "image/png");
    check(stored.provider === "fake-bucket" && stored.url?.startsWith("https://cdn.crewcut.test/") && !existsSync(storagePath("assets", "e2e-remote.png")), "auto mode stores uploads in a configured bucket, not on disk");
    const urls = await blob.resolveFileUrls("assets", ["e2e-remote.png", "e2e-local.png"]);
    check(urls.get("e2e-remote.png") === stored.url && urls.get("e2e-local.png")?.startsWith("/api/media/"), "file URLs resolve per file: bucket URL or signed local link");

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const id = String(input instanceof Request ? input.url : input).split("/").pop() ?? "";
      const bytes = bucket.get(id);
      return bytes ? new Response(Buffer.from(bytes)) : new Response("missing", { status: 404 });
    }) as typeof fetch;
    try {
      const copy = await blob.localCopy("assets", "e2e-remote.png");
      check(existsSync(copy), "a remote file is downloaded when a local copy is needed (YouTube upload, render)");
    } finally {
      globalThis.fetch = realFetch;
    }

    await writeStorageFile("renders", "e2e-render.mp4", new Uint8Array([7, 8, 9]));
    await blob.promoteToRemote("renders", "e2e-render.mp4", "video/mp4");
    check((await blob.fileUrl("renders", "e2e-render.mp4")).startsWith("https://cdn.crewcut.test/"), "a finished render is promoted to the bucket on first link");

    const library = await call<{ items: Array<{ url: string }> }>("list-audio-library", {}, human);
    check(library.items.length > 0 && library.items.every((item) => item.url.startsWith("https://cdn.crewcut.test/")), "built-in library sounds are served from the bucket");

    const before = bucket.size;
    await blob.removeFile("assets", "e2e-remote.png");
    check(bucket.size === before - 1 && !(await blob.isStoredRemotely("assets", "e2e-remote.png")) && !existsSync(storagePath("assets", "e2e-remote.png")), "deleting a file removes the bucket object, its index row and the local copy");

    unregisterFileUploadProvider("fake-bucket");
    process.env.CREWCUT_STORAGE = "remote";
    await expectFailure(blob.putFile("assets", "e2e-nowhere.png", new Uint8Array([1]), "image/png"), /no file storage is configured/, "CREWCUT_STORAGE=remote refuses to fall back to disk silently");
  } finally {
    unregisterFileUploadProvider("fake-bucket");
    if (previous === undefined) delete process.env.CREWCUT_STORAGE;
    else process.env.CREWCUT_STORAGE = previous;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      // PGlite may still hold the directory on Windows; the OS temp dir cleans up.
    }
  });
