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
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scratch = mkdtempSync(path.join(os.tmpdir(), "crewcut-e2e-"));
process.env.DATABASE_URL = `pglite:${path.join(scratch, "db")}`;
process.env.CREWCUT_STORAGE_DIR = path.join(scratch, "storage");
process.env.CREWCUT_RENDER_MODE = "queue"; // queue only: don't launch Chromium in the check
process.env.NODE_ENV = "development";
// The bundled template library, music only: the check stays offline (bundled photo picks would download from Pexels).
const library = path.join(scratch, "library");
cpSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "library", "templates", "music"), path.join(library, "music"), { recursive: true });
process.env.CREWCUT_TEMPLATE_LIBRARY_DIR = library;
// No network in the check: templates fall back to their designed placeholders; music comes from the bundle.
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

  // Edits that arrive together (quick nudges in the editor, the agent and a person at once) must all land.
  const together = [701, 702, 703, 704, 705, 706];
  const landed = await Promise.all(together.map((value, index) => call<{ version: number }>("set-keyframe", { videoId, clipId: scene2.id, layerId: layer.id, property: "y", atMs: 100 + index * 100, value, easing: "linear" }, human)));
  check(new Set(landed.map((entry) => entry.version)).size === together.length, "edits saved at the same moment each get their own version");
  const afterTogether = JSON.stringify((await call<{ composition: unknown }>("get-composition", { videoId }, human)).composition);
  check(together.every((value) => afterTogether.includes(`"value":${value}`)), "and none of them overwrites another");

  // 8. Variety guard, render job, publish gate.
  const variety = await call<{ tooSimilar: boolean; comparisons: unknown[] }>("check-sameness", { videoId }, human);
  check(variety.tooSimilar === false, "the variety guard runs (no look-alikes in a fresh workspace)");
  const render = await call<{ renderId: string; mode: string }>("render-video", { videoId });
  check(render.mode === "queue" && render.renderId.startsWith("rnd_"), "rendering is queued for a separate worker");
  await expectFailure(call("publish-post", { publishJobId: "pub_x" }, agent), /needs a person|signed-in app UI/, "the agent can never publish");
  // Publishing from the editor prepares a fresh post each time: an older unpublished draft is retired so only the latest copy can go out.
  const { getDb, schema } = await import("../server/db/index.js");
  const { eq } = await import("drizzle-orm");
  await getDb().update(schema.renderJobs).set({ status: "done", outputFile: "e2e.mp4", outputBytes: 1000 }).where(eq(schema.renderJobs.id, render.renderId));
  const postArgs = (title: string) => ({ videoId, platform: "youtube", privacy: "private", copy: { title, description: "", hashtags: [], keywords: [], sources: [], language: "en" } });
  const firstPost = await call<{ publishJobId: string }>("prepare-post", postArgs("First draft"));
  const secondPost = await call<{ publishJobId: string }>("prepare-post", postArgs("Second draft"), human);
  const posts = await call<{ publishJobs: Array<{ id: string; status: string }> }>("get-video", { videoId, include: ["publish"] }, human);
  const statusOf = (id: string) => posts.publishJobs.find((job) => job.id === id)?.status;
  check(statusOf(firstPost.publishJobId) === "cancelled" && statusOf(secondPost.publishJobId) === "awaiting_approval", "a newer post retires the unpublished draft");

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

  // 12. Saved templates, the catalog and Pro.
  await checkCatalog();

  // 12b. Autopilot: the crew makes the whole video with nobody approving; fact-check loops; export ends it.
  await checkAutopilot();

  // 12c. Credits and Bachs billing: monthly grants, spending, top-ups once, plan changes from webhooks.
  await checkCreditsAndBilling();

  // 13. Search and paging run in the database, with counts per filter.
  await checkSearchAndPaging();

  // 14. Remote file storage (R2/S3/Builder) through a fake provider: one index, any backend.
  await checkRemoteStorage();
  console.log(`\nAll ${passed} checks passed.`);
}

async function checkCreditsAndBilling(): Promise<void> {
  const { ensureBalance, spendCredits } = await import("../server/lib/credits.ts");
  const { handleBachsEvent } = await import("../server/lib/billing/webhooks.ts");
  const { recordAiUsage } = await import("../server/lib/ai/usage.ts");
  const buyer: Ctx = { caller: "frontend", userEmail: "buyer@crewcut.test", orgId: null };
  const workspace = `user:${buyer.userEmail}`;
  type Credits = { balance: { plan: string; available: number; monthly: number; topup: number }; usedThisPeriod: Array<{ stage: string; credits: number }> };
  const credits = () => call<Credits>("get-credits", {}, buyer);

  let state = await credits();
  check(state.balance.plan === "free" && state.balance.available === 100, "a new workspace starts on Free with 100 credits");

  // A Crewcut AI call is logged and charged (cost × 3 ÷ $0.05): $0.10 → 6 credits.
  const charged = await recordAiUsage({ ownerEmail: buyer.userEmail, orgId: null, source: "managed", kind: "llm", provider: "workers-ai", model: "@cf/zai-org/glm-5.3", inputTokens: 1000, outputTokens: 100, costMicros: 100_000, stage: "script" });
  await recordAiUsage({ ownerEmail: buyer.userEmail, orgId: null, source: "byok", kind: "llm", provider: "anthropic", model: "claude-sonnet-5-5", inputTokens: 1000, outputTokens: 100, costMicros: 100_000, stage: "script" });
  state = await credits();
  check(charged === 6000 && state.balance.available === 94, "Crewcut AI use costs credits; the person's own keys don't");
  check(state.usedThisPeriod.some((row) => row.stage === "script" && row.credits === 6), "what used the credits shows by pipeline step");

  await spendCredits(workspace, 200_000, "e2e:overspend", "test");
  const empty = await ensureBalance(workspace);
  check(empty.available <= 0, "an overspent workspace has nothing left");
  const { assertCredits } = await import("../server/lib/credits.ts");
  await expectFailure(assertCredits(workspace, "the crew"), /out of AI credits/, "and Crewcut AI then stops with a plain message");

  const products = { BACHS_PRODUCT_CREATOR_MONTH: "prod_cm", BACHS_PRODUCT_CREATOR_YEAR: "prod_cy", BACHS_PRODUCT_STUDIO_MONTH: "prod_sm", BACHS_PRODUCT_STUDIO_YEAR: "prod_sy", BACHS_PRODUCT_TOPUP_300: "prod_t300", BACHS_PRODUCT_TOPUP_1000: "prod_t1000" };
  Object.assign(process.env, products);
  try {
    const subscription = (type: string, extra: Record<string, unknown> = {}) => ({
      id: `evt_${Math.random().toString(36).slice(2)}`,
      type,
      data: { subscription_id: "sub_e2e", product_id: "prod_sy", status: "active", customer: { customer_id: "cust_e2e", email: buyer.userEmail }, metadata: { workspace }, current_period_end: "2026-12-31T00:00:00Z", cancel_at_period_end: false, ...extra },
    });
    await handleBachsEvent(subscription("customer.subscription.created"));
    state = await credits();
    check(state.balance.plan === "studio", "a Studio subscription webhook moves the workspace to Studio");
    check(state.balance.available >= 1700, "and adds the Studio credits straight away");

    const payment = { id: "evt_pay_e2e", type: "collection.succeeded", data: { checkout_id: "chk_e2e", charge_id: "ch_e2e", customer: { id: "cust_e2e" }, product_cart: [{ product_id: "prod_t300", quantity: 1 }], metadata: { workspace } } };
    const before = state.balance.topup;
    await handleBachsEvent(payment);
    const again = await handleBachsEvent(payment);
    await handleBachsEvent({ ...payment, id: "evt_pay_e2e_retry" });
    state = await credits();
    check(again.duplicate && state.balance.topup === before + 300, "a paid top-up adds 300 credits once, however often it's delivered");

    await handleBachsEvent(subscription("customer.subscription.deleted", { status: "canceled" }));
    state = await credits();
    check(state.balance.plan === "free" && state.balance.monthly <= 100 && state.balance.topup === before + 300, "cancelling ends at Free, capped to Free's credits, bought credits kept");
    // Deliveries aren't ordered: an "updated" event from before the cancellation arriving late must not bring the plan back.
    await handleBachsEvent({ ...subscription("customer.subscription.updated"), created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    state = await credits();
    check(state.balance.plan === "free", "a late event from before the cancellation doesn't bring the plan back");
    await expectFailure(call("start-checkout", { item: "creator" }, agent), /needs a person|signed-in app UI/, "the agent can't start a payment");

    // Spending across both pools is recorded per pool.
    const { addTopUp, recentLedger } = await import("../server/lib/credits.ts");
    const split = "user:split@crewcut.test";
    await ensureBalance(split);
    await addTopUp(split, 300, "e2e:split-topup", "test top-up");
    await spendCredits(split, 120_000, "e2e:split-spend", "test spend");
    const splitBalance = await ensureBalance(split);
    const splitRows = (await recentLedger(split)).filter((row) => row.kind === "usage");
    check(splitBalance.monthly === 0 && splitBalance.topup === 280, "spending takes this month's credits first, then bought ones");
    check(splitRows.some((row) => row.pool === "monthly" && row.millicredits === -100_000) && splitRows.some((row) => row.pool === "topup" && row.millicredits === -20_000), "and the history shows how much came from each");

    // A subscriber's credits follow the Bachs billing period; a renewal refills them once.
    const renew = "user:renew@crewcut.test";
    const p1 = { start: "2026-11-05T10:00:00.000Z", end: "2026-12-05T10:00:00.000Z" };
    const p2 = { start: "2026-12-05T10:00:00.000Z", end: "2027-01-05T10:00:00.000Z" };
    const sub = (period: { start: string; end: string }) => ({ subscription_id: "sub_renew", product_id: "prod_cm", status: "active", customer: { customer_id: "cust_renew" }, metadata: { workspace: renew }, current_period_start: period.start, current_period_end: period.end, cancel_at_period_end: false });
    await handleBachsEvent({ id: "evt_renew_created", type: "customer.subscription.created", data: sub(p1) });
    let renewBalance = await ensureBalance(renew);
    check(renewBalance.plan === "creator" && renewBalance.periodEnd === p1.end, "a new subscription's credit period follows its billing period");
    await spendCredits(renew, 50_000, "e2e:renew-spend", "test spend");

    const realFetch = globalThis.fetch;
    process.env.BACHS_SECRET_KEY = "sk_sandbox_e2e";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes("/v1/subscriptions/sub_renew")) throw new Error(`unexpected request ${url}`);
      const { product_id: _productId, subscription_id: _subscriptionId, ...rest } = sub(p2);
      return new Response(JSON.stringify({ ...rest, id: "sub_renew", product: { id: "prod_cm" } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const invoice = (id: string) => ({ id, type: "invoice.paid", data: { invoice_id: "inv_renew", subscription: { subscription_id: "sub_renew" }, customer: { customer_id: "cust_renew" }, period_start: p2.start, period_end: p2.end } });
      await handleBachsEvent(invoice("evt_renew_paid"));
      renewBalance = await ensureBalance(renew);
      check(renewBalance.periodEnd === p2.end && renewBalance.monthly === 600, "a renewal (invoice paid) starts the new period with a full month of credits");
      await handleBachsEvent(invoice("evt_renew_paid_again"));
      const grants = (await recentLedger(renew)).filter((row) => row.kind === "grant" && row.note.includes("billing period"));
      check(grants.length === 1 && (await ensureBalance(renew)).monthly === 600, "and a repeated renewal event refills nothing twice");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.BACHS_SECRET_KEY;
    }
  } finally {
    for (const name of Object.keys(products)) delete process.env[name];
  }
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
  const music = composition.composition.tracks.filter((track) => track.kind === "audio").flatMap((track) => track.clips);
  check(music.length > 0 && existsSync(path.join(process.env.CREWCUT_STORAGE_DIR ?? "", "assets", "lib-template-product-drop.mp3")), "a fresh server copies the bundled template music into storage (nothing regenerated)");
  await expectFailure(call("use-template", { templateId: "golden-hour", ratio: "9:16", values: { headline: "x" } }, human), /no slot "headline"/, "an unknown slot id is refused (no silent typos)");
  await expectFailure(call("generate-template-music", {}, agent), /needs a person|signed-in app UI/, "the agent can't spend the music allowance");
}

/** Autopilot end to end, through the same actions the background agent run calls. */
async function checkAutopilot(): Promise<void> {
  const { DEMO_SOURCE, demoDossier, demoIdeas, demoScript } = await import("@crewcut/pipeline");
  const { getDb, schema } = await import("../server/db/index.ts");
  const { eq } = await import("drizzle-orm");
  type Board = { stages: Record<string, { status: string }>; video: { pickedIdeaId: string | null; title: string }; autopilot: { on: boolean; phase: string; qaRounds: number; reason: string | null; decisions: Array<{ text: string }> } | null; approvals: Array<{ stage: string; decision: string; actorKind: string; reason: string | null }> };
  const board = (videoId: string) => call<Board>("get-video", { videoId }, human);

  await expectFailure(call("start-pipeline", { brief: "Why do cats purr?", autopilot: true }, agent), /Only the person can put a video on autopilot/, "the agent can't put a video on autopilot");
  await expectFailure(call("start-pipeline", { brief: "Why do cats purr?", autopilot: true }, human), /Autopilot is part of Creator and Studio/, "on Free, autopilot asks for Creator or Studio");
  const creator = { plan: "creator", source: "e2e", note: "", updatedBy: "e2e", updatedAt: new Date().toISOString() };
  await getDb().insert(schema.workspacePlans).values({ workspace: `user:${human.userEmail}`, ...creator }).onConflictDoUpdate({ target: schema.workspacePlans.workspace, set: creator });
  const { videoId } = await call<{ videoId: string }>("start-pipeline", { brief: "Why do spring animations feel physical?", ratio: "9:16", autopilot: true }, human);

  // Ideas: the top-scored one is picked without a click.
  const trend = await call<{ status: string; picked?: { title: string } }>("find-trends", { videoId, ideas: demoIdeas() });
  let state = await board(videoId);
  const top = [...demoIdeas()].sort((a, b) => b.score - a.score)[0];
  check(trend.status === "notified" && state.video.pickedIdeaId === top?.id, "on autopilot the top-scored idea is picked without waiting for a person");

  // Research and script move on by themselves.
  const source = await call<{ sourceId: string }>("add-source", { videoId, text: DEMO_SOURCE.text, title: DEMO_SOURCE.title, publisher: DEMO_SOURCE.publisher });
  const seeded = demoDossier(new Date().toISOString());
  await call("build-dossier", { videoId, topic: seeded.topic, angle: seeded.angle, summary: seeded.summary, facts: seeded.facts.map(({ verified: _verified, locator: _locator, ...fact }) => ({ ...fact, sourceId: source.sourceId })) });
  const script = await call<{ status: string }>("write-script", { videoId, script: demoScript() });
  check(script.status === "notified", "the script doesn't wait for approval on autopilot");

  // Fact-check: the unsupported claim fails, round after round, until autopilot stops for the person.
  const round1 = await call<{ blockers: unknown[]; autopilot?: { round: number; stopped: boolean }; next: string }>("audit-claims", { videoId });
  check(round1.blockers.length === 1 && round1.autopilot?.round === 1 && !round1.autopilot.stopped && /Fix every blocker/.test(round1.next), "a failed fact-check goes back to the script with the reason (round 1 of 3)");
  await call("audit-claims", { videoId });
  const round3 = await call<{ autopilot?: { round: number; stopped: boolean }; next: string }>("audit-claims", { videoId });
  state = await board(videoId);
  check(round3.autopilot?.stopped === true && state.autopilot?.phase === "needs_you" && /no source/.test(state.autopilot.reason ?? ""), "after 3 failed rounds autopilot stops and says which claims need the person");
  await expectFailure(call("set-autopilot", { videoId, action: "resume" }, agent), /needs a person|signed-in app UI/, "the agent can't resume autopilot itself");

  // The person fixes it and resumes: the fact-check passes and the gate opens on its own.
  await call("set-autopilot", { videoId, action: "resume" }, human);
  state = await board(videoId);
  check(state.autopilot?.phase === "making" && state.autopilot.qaRounds === 0, "resuming starts the fact-check rounds again");
  await call("apply-fix", { videoId, claimId: "claim:l9", fixIndex: (await call<{ fixes: Array<{ index: number; kind: string }> }>("apply-fix", { videoId, claimId: "claim:l9" })).fixes.find((fix) => fix.kind === "cut")?.index });
  await call("audit-claims", { videoId });
  state = await board(videoId);
  check(state.stages.qa?.status === "notified" && state.autopilot?.decisions.some((decision) => /Fact-check passed/.test(decision.text)), "once every claim has a source, fact-check passes without a click");

  // Animation and voice, then the export ends the run.
  const composed = await call<{ status: string }>("compose-video", { videoId });
  const voiced = await call<{ status: string }>("synthesize-voice", { videoId });
  check(composed.status === "notified" && voiced.status === "notified", "animation and voice move on by themselves");
  const render = await call<{ renderId: string }>("render-video", { videoId });
  state = await board(videoId);
  check(state.autopilot?.phase === "exporting", "exporting is autopilot's last step");
  await getDb().update(schema.renderJobs).set({ status: "done", progress: 1, outputFile: `${render.renderId}.mp4` }).where(eq(schema.renderJobs.id, render.renderId));
  state = await board(videoId);
  check(state.autopilot?.phase === "ready", "when the export finishes, the video is ready to review");
  check(state.stages.publish?.status !== "approved" && !state.approvals.some((event) => event.stage === "publish" && event.decision === "published"), "nothing is published on autopilot");
  check(state.approvals.filter((event) => event.decision === "notified").every((event) => /Autopilot, switched on by e2e@crewcut\.test/.test(event.reason ?? "")) && !state.approvals.some((event) => event.decision === "approved" && event.actorKind === "agent"), "the approval log says each step went ahead on autopilot, switched on by the person");
  const listed = await call<{ videos: Array<{ id: string; phase: string }> }>("list-autopilot", {}, human);
  check(listed.videos.some((video) => video.id === videoId && video.phase === "ready"), "the person's autopilot list shows it ready");

  // After autopilot hands over, the person's edits go through the usual gates again.
  const again = await call<{ status: string }>("compose-video", { videoId });
  check(again.status === "awaiting_approval", "once autopilot has handed the video over, new work waits for the person again");
}

/** "Save as template", workspace privacy, the catalog's people-only steps and the Pro export rule. */
async function checkCatalog(): Promise<void> {
  const { getDb, schema } = await import("../server/db/index.ts");
  const { eq } = await import("drizzle-orm");
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const db = getDb();
  const other: Ctx = { caller: "frontend", userEmail: "someone-else@crewcut.test", orgId: null };
  // The e2e person is the catalog admin; someone-else is not.
  process.env.CREWCUT_ADMIN_EMAILS = human.userEmail;
  type Layered = { composition: { tracks: Array<{ kind: string; clips: Array<{ id: string; layers?: Array<{ id: string; slot?: string; type: string; text?: string; src?: string }> }> }> } };
  const layersOf = (body: Layered) => body.composition.tracks.flatMap((track) => (track.kind === "visual" ? track.clips.flatMap((clip) => (clip.layers ?? []).map((layer) => ({ clipId: clip.id, ...layer }))) : []));

  // A template-made video with one of the person's own photos in it.
  const source = await call<{ videoId: string }>("use-template", { templateId: "product-drop", ratio: "1:1", values: { product: "ORBIT ONE" } }, human);
  const assets = path.join(process.env.CREWCUT_STORAGE_DIR ?? "", "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(assets, "ast_e2e_photo.png"), Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex"));
  await db.insert(schema.assets).values({ id: "ast_e2e_photo", videoId: source.videoId, kind: "image", label: "My product shot", fileName: "ast_e2e_photo.png", mime: "image/png", bytes: 30, licence: "{}", ownerEmail: human.userEmail, orgId: null });
  const before = layersOf(await call<Layered>("get-composition", { videoId: source.videoId }, human));
  const photo = before.find((layer) => layer.type === "image" && layer.slot?.startsWith("photo"));
  const product = before.find((layer) => layer.slot === "product");
  if (!photo || !product) throw new Error("✘ product-drop has a photo and a product slot");
  await call("edit-composition", { videoId: source.videoId, label: "My photo", ops: [{ op: "update-layer", clipId: photo.clipId, layerId: photo.id, patch: { src: "asset:ast_e2e_photo" } }] }, human);

  const saved = await call<{ templateId: string; slots: number }>("save-as-template", { videoId: source.videoId, name: "Orbit promo", category: "promo", slots: [{ clipId: photo.clipId, layerId: photo.id, label: "Product photo" }, { clipId: product.clipId, layerId: product.id, label: "Product name" }] }, agent);
  check(saved.slots === 2, "a video saves as a template with the chosen slots");
  type Listing = { templates: Array<{ id: string; source: string; tier: string; slots: Array<{ id: string }>; canDelete: boolean }>; yours: number };
  const mine = await call<Listing>("list-templates", { source: "yours" }, human);
  check(mine.templates.some((template) => template.id === saved.templateId && template.source === "workspace" && template.canDelete), "the saved template is listed under Yours, removable by its owner");
  const theirs = await call<Listing>("list-templates", {}, other);
  check(!theirs.templates.some((template) => template.id === saved.templateId) && theirs.yours === 0, "someone outside the workspace never sees it");
  await expectFailure(call("use-template", { templateId: saved.templateId, ratio: "1:1" }, other), /No template/, "and can't use it by id");

  // The template keeps working after the video it came from is deleted.
  await call("delete-video", { videoId: source.videoId }, human);
  const made = await call<{ videoId: string }>("use-template", { templateId: saved.templateId, ratio: "1:1", values: { "product-name": "ORBIT TWO" } }, human);
  const copied = layersOf(await call<Layered>("get-composition", { videoId: made.videoId }, human));
  const copiedPhoto = copied.find((layer) => layer.slot === "product-photo");
  const [photoRow] = copiedPhoto?.src?.startsWith("asset:") ? await db.select().from(schema.assets).where(eq(schema.assets.id, copiedPhoto.src.slice(6))) : [];
  check(copied.some((layer) => layer.slot === "product-name" && layer.text === "ORBIT TWO"), "using it puts the person's words in its slots");
  check(Boolean(photoRow?.fileName.startsWith("tpl-")) && existsSync(path.join(assets, photoRow?.fileName ?? "missing")) && photoRow?.videoId === made.videoId, "its photo survives the source video's deletion (a shared template file, a new asset row)");

  await expectFailure(call("delete-template", { templateId: saved.templateId }, agent), /needs a person|signed-in app UI/, "the agent can't remove a template");
  await expectFailure(call("delete-template", { templateId: saved.templateId }, other), /only remove templates you saved/, "nor can someone else");
  await call("delete-template", { templateId: saved.templateId }, human);
  const after = await call<Listing>("list-templates", { source: "yours" }, human);
  check(!after.templates.some((template) => template.id === saved.templateId), "its owner can remove it from the gallery");
  const madeAfter = await call<Layered>("get-composition", { videoId: made.videoId }, human);
  check(layersOf(madeAfter).some((layer) => layer.text === "ORBIT TWO"), "videos already made from it are untouched");

  // Catalog: a Pro pack, a template published into it, and the export rule.
  const pack = await call<{ packId: string }>("save-catalog-pack", { name: "E2E Pro", tier: "pro" }, agent);
  await expectFailure(call("save-catalog-pack", { packId: pack.packId, status: "published" }, agent), /needs a person/, "the agent can't publish a pack");
  await call("save-catalog-pack", { packId: pack.packId, status: "published" }, human);
  const draft = await call<{ itemId: string }>("publish-video-as-template", { videoId: made.videoId, packId: pack.packId, name: "Orbit Pro", slots: [{ clipId: copiedPhoto?.clipId ?? "", layerId: copiedPhoto?.id ?? "", label: "Product photo" }] }, agent);
  const hidden = await call<Listing>("list-templates", {}, other);
  check(!hidden.templates.some((template) => template.id === draft.itemId), "a catalog template stays out of the gallery until it's published");
  await expectFailure(call("set-catalog-item-status", { itemId: draft.itemId, status: "published" }, agent), /needs a person|signed-in app UI/, "the agent can't publish catalog content");
  await call("set-catalog-item-status", { itemId: draft.itemId, status: "published" }, human);
  const listed = await call<Listing>("list-templates", {}, other);
  check(listed.templates.some((template) => template.id === draft.itemId && template.tier === "pro"), "once published, everyone sees it with its Pro tier");
  const pro = await call<{ videoId: string; tier: string }>("use-template", { templateId: draft.itemId, ratio: "1:1" }, other);
  check(pro.tier === "pro", "anyone can start from a Pro template");
  await expectFailure(call("render-video", { videoId: pro.videoId }, other), /uses Pro content: Orbit Pro template\./, "exporting Pro content needs Pro, and the message names it once");
  await expectFailure(call("set-workspace-plan", { workspace: other.userEmail, plan: "pro" }, agent), /needs a person|signed-in app UI/, "the agent can't hand out Pro");
  await call("set-workspace-plan", { workspace: other.userEmail, plan: "pro" }, human);
  const rendered = await call<{ renderId: string }>("render-video", { videoId: pro.videoId }, other);
  check(Boolean(rendered.renderId), "with Pro, the same export goes ahead");
  const access = await call<{ plan: string }>("get-catalog-access", {}, other);
  check(access.plan === "pro", "the workspace's plan reads back as Pro");

  // Only listed admins manage the catalog.
  await expectFailure(call("list-catalog", {}, other), /Only Crewcut admins/, "people who aren't admins can't open the catalog");
  await expectFailure(call("save-catalog-pack", { name: "Sneaky" }, other), /Only Crewcut admins/, "or change it");
  delete process.env.CREWCUT_ADMIN_EMAILS;
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
