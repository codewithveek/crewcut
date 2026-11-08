import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { latestAudit, latestComposition, latestScript, listApprovals, listSources, loadDossier, loadVideo } from "../server/lib/store.js";

/**
 * The Proof report: every claim with its source, every human decision and
 * every AI-generated asset. It shows the human creative input platforms look
 * for, and doubles as a client deliverable.
 */
export default defineAction({
  description: "Compile the Proof report for a video: claims with their sources and verdicts, human decisions, AI-generated and licensed assets, sources and the published result.",
  schema: z.object({ videoId: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ videoId }, ctx) => {
    const db = getDb();
    const R = schema.renderJobs;
    // The access check runs alongside the reads; nothing is returned unless it passes.
    const [video, audit, dossier, scriptEntry, compositionEntry, approvals, sources, assets, publishes, renders, scriptVersions, compositionVersions] = await Promise.all([
      loadVideo(videoId, ctx),
      latestAudit(videoId),
      loadDossier(videoId),
      latestScript(videoId),
      latestComposition(videoId),
      listApprovals(videoId),
      listSources(videoId),
      db.select().from(schema.assets).where(eq(schema.assets.videoId, videoId)),
      db.select().from(schema.publishJobs).where(eq(schema.publishJobs.videoId, videoId)).orderBy(desc(schema.publishJobs.createdAt)),
      db.select({ id: R.id, status: R.status, compositionVersion: R.compositionVersion, ratio: R.ratio, createdAt: R.createdAt }).from(R).where(eq(R.videoId, videoId)).orderBy(desc(R.createdAt)),
      db.select({ version: schema.scripts.version, authorKind: schema.scripts.authorKind, author: schema.scripts.author, note: schema.scripts.note, createdAt: schema.scripts.createdAt }).from(schema.scripts).where(eq(schema.scripts.videoId, videoId)).orderBy(schema.scripts.version),
      db.select({ authorKind: schema.compositions.authorKind }).from(schema.compositions).where(eq(schema.compositions.videoId, videoId)),
    ]);
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const factById = new Map((dossier?.facts ?? []).map((fact) => [fact.id, fact]));
    const humanEdits = compositionVersions.filter((entry) => entry.authorKind === "human").length;
    const agentEdits = compositionVersions.length - humanEdits;

    return {
      video: { id: video.row.id, title: video.row.title, ratio: video.row.ratio, status: video.row.status, isDemo: video.row.isDemo, createdAt: video.row.createdAt },
      summary: {
        claims: audit?.results.length ?? 0,
        supported: audit?.counts.supported ?? 0,
        weak: audit?.counts.weak ?? 0,
        unsupported: audit?.counts.unsupported ?? 0,
        overridden: audit?.counts.overridden ?? 0,
        verifiedFacts: dossier?.facts.filter((fact) => fact.verified).length ?? 0,
        facts: dossier?.facts.length ?? 0,
        humanDecisions: approvals.filter((event) => event.actorKind === "human").length,
        scriptVersions: scriptVersions.length,
        humanScriptEdits: scriptVersions.filter((entry) => entry.authorKind === "human").length,
        compositionEdits: { human: humanEdits, agent: agentEdits },
      },
      claims: (audit?.results ?? []).map((result) => ({
        lineId: result.lineId,
        text: result.text,
        verdict: result.verdict,
        overrideReason: result.overrideReason ?? null,
        overriddenBy: result.overriddenBy ?? null,
        evidence: result.evidence.map((evidence) => {
          const source = sourceById.get(evidence.sourceId);
          const fact = factById.get(evidence.factId);
          return {
            factId: evidence.factId,
            quote: evidence.quote,
            verified: fact?.verified ?? false,
            lines: fact?.locator ? `${fact.locator.lineStart}–${fact.locator.lineEnd}` : null,
            source: source ? { title: source.title, url: source.url, publisher: source.publisher } : null,
          };
        }),
      })),
      decisions: approvals,
      assets: assets.map((asset) => {
        const licence = JSON.parse(asset.licence) as { name: string; commercialUse: boolean; aiGenerated?: boolean };
        const provenance = JSON.parse(asset.provenance) as { provider?: string };
        return { id: asset.id, kind: asset.kind, label: asset.label, licence: licence.name, commercialUse: licence.commercialUse, aiGenerated: licence.aiGenerated ?? false, provider: provenance.provider ?? "unknown" };
      }),
      aiDisclosure: {
        script: scriptEntry?.authorKind === "agent" ? "Drafted by the script agent; approved by a person." : "Written by a person.",
        visuals: compositionEntry ? `Composed from code-driven layers by the motion director (${agentEdits} agent edits, ${humanEdits} human edits). No generated pixels unless listed under assets.` : "Not composed yet.",
        voice: assets.some((asset) => asset.kind === "voice") ? "AI voice (see assets)." : "No synthesized voice.",
      },
      sources: sources.map((source) => ({ id: source.id, title: source.title, url: source.url, publisher: source.publisher, retrievedAt: source.retrievedAt, redactions: source.redactions })),
      published: publishes.filter((job) => job.status === "published").map((job) => ({ platform: job.platform, url: job.url, privacy: job.privacy, approvedBy: job.approvedBy, approvedAt: job.approvedAt })),
      renders: renders.filter((render) => render.status === "done").map((render) => ({ id: render.id, compositionVersion: render.compositionVersion, ratio: render.ratio, createdAt: render.createdAt })),
      generatedAt: new Date().toISOString(),
    };
  },
});
