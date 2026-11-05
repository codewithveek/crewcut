import { defineAction } from "@agent-native/core/action";
import { locateQuote, verifyQuote } from "@crewcut/claim-audit";
import { dossierSchema, factSchema } from "@crewcut/contracts";
import { z } from "zod";

import { finishStage } from "../server/lib/pipeline-ops.js";
import { listSources, loadVideo, saveDossier } from "../server/lib/store.js";

export default defineAction({
  description:
    "Research agent: save the dossier. Every fact cites a sourceId from add-source and quotes it VERBATIM; each quote is checked mechanically against the stored text and marked verified or not. Unverified facts can't support script claims. Rate confidence honestly (high: primary or 2+ independent sources; low: unverified).",
  schema: z.object({
    videoId: z.string(),
    topic: z.string().min(3).max(200),
    angle: z.string().min(3).max(400),
    summary: z.string().max(2000).default(""),
    facts: z.array(factSchema.omit({ verified: true, locator: true })).min(1).max(40),
    analogies: z.array(z.string().max(200)).max(8).default([]),
    openQuestions: z.array(z.string().max(300)).max(10).default([]),
  }),
  run: async (args, ctx) => {
    const video = await loadVideo(args.videoId, ctx, "editor");
    const sources = await listSources(video.row.id);
    const byId = new Map(sources.map((source) => [source.id, source]));
    const facts = args.facts.map((fact) => {
      const source = byId.get(fact.sourceId);
      const verified = source ? verifyQuote(fact.quote, source.content).found : false;
      const locator = source && verified ? locateQuote(fact.quote, source.content) : null;
      return { ...fact, verified, ...(locator ? { locator } : {}) };
    });
    const dossier = dossierSchema.parse({
      topic: args.topic,
      angle: args.angle,
      summary: args.summary,
      facts,
      analogies: args.analogies,
      openQuestions: args.openQuestions,
      sources: sources.map((source) => ({
        id: source.id,
        kind: source.kind,
        title: source.title,
        ...(source.url ? { url: source.url } : {}),
        ...(source.publisher ? { publisher: source.publisher } : {}),
        retrievedAt: source.retrievedAt,
        contentHash: source.contentHash,
        length: source.content.length,
        redactions: source.redactions,
      })),
    });
    await saveDossier(video, dossier);
    const unverified = facts.filter((fact) => !fact.verified);
    const status = await finishStage(video, "research", { note: `${facts.length - unverified.length}/${facts.length} facts verified against their sources` });
    return {
      facts: facts.length,
      verified: facts.length - unverified.length,
      unverified: unverified.map((fact) => ({ id: fact.id, sourceId: fact.sourceId, reason: byId.has(fact.sourceId) ? "Quote not found verbatim in the source" : "Unknown sourceId" })),
      status,
      next: unverified.length > 0 ? "Fix or drop unverified facts (re-quote exactly), then write the script." : "Write the script with write-script; cite fact ids on every factual line.",
    };
  },
});
