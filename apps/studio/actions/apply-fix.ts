import { defineAction } from "@agent-native/core/action";
import { applyFix, suggestFixes } from "@crewcut/claim-audit";
import { z } from "zod";

import { runAuditAndQa } from "../server/lib/pipeline-ops.js";
import { latestAudit, latestScript, loadDossier, loadVideo, recordApproval, saveScript } from "../server/lib/store.js";

export default defineAction({
  description:
    "Apply a suggested fix to a flagged claim: cite a verified fact, rewrite with the sourced figure, soften an absolute, or cut the line. Without fixIndex, returns the available fixes. Saves a new script version and re-runs QA.",
  schema: z.object({
    videoId: z.string(),
    claimId: z.string().describe('e.g. "claim:l9"'),
    fixIndex: z.number().int().min(0).optional(),
  }),
  run: async ({ videoId, claimId, fixIndex }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const [scriptEntry, dossier, audit] = await Promise.all([latestScript(videoId), loadDossier(videoId), latestAudit(videoId)]);
    if (!scriptEntry || !dossier || !audit) throw new Error("Fact-check the script first.");
    const result = audit.results.find((candidate) => candidate.claimId === claimId);
    if (!result) throw new Error(`No claim ${claimId} in the latest audit`);
    const fixes = suggestFixes(result, scriptEntry.script, dossier);
    if (fixIndex === undefined) return { claimId, text: result.text, verdict: result.verdict, fixes: fixes.map((fix, index) => ({ index, kind: fix.kind, label: fix.label })) };
    const fix = fixes[fixIndex];
    if (!fix) throw new Error(`No fix #${fixIndex}; there are ${fixes.length}.`);
    const fixed = applyFix(scriptEntry.script, fix);
    const version = await saveScript(video, fixed, `Fix ${result.lineId}: ${fix.label}`);
    await recordApproval(video, { stage: "qa", decision: "approved", reason: `Applied fix: ${fix.label}`, subject: `${claimId} → script v${version}` });
    const summary = await runAuditAndQa(video, { completeQaStage: true });
    return { applied: fix.label, scriptVersion: version, qa: summary };
  },
});
