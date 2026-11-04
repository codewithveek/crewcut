/**
 * End-to-end check of the Proofcut pipeline through its real actions, against
 * a throwaway PGlite database:
 *   pnpm --filter @proofcut/studio e2e
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

const scratch = mkdtempSync(path.join(os.tmpdir(), "proofcut-e2e-"));
process.env.DATABASE_URL = `pglite:${path.join(scratch, "db")}`;
process.env.PROOFCUT_STORAGE_DIR = path.join(scratch, "storage");
process.env.PROOFCUT_RENDER_MODE = "queue"; // queue only: don't launch Chromium in the check
process.env.NODE_ENV = "development";

type Ctx = { caller: "frontend" | "tool"; userEmail: string; orgId: null };
const human: Ctx = { caller: "frontend", userEmail: "e2e@proofcut.test", orgId: null };
const agent: Ctx = { caller: "tool", userEmail: "e2e@proofcut.test", orgId: null };

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
  const { DEMO_SOURCE, demoDossier, demoIdeas, demoScript } = await import("@proofcut/pipeline");

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
  console.log(`\nAll ${passed} checks passed.`);
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
