import { defineAction } from "@agent-native/core/action";
import { auditClaims } from "@crewcut/claim-audit";
import { scriptSchema, scriptWordCount, wordBudget } from "@crewcut/contracts";
import { invalidateFrom } from "@crewcut/pipeline";
import { z } from "zod";

import { nowIso } from "../server/lib/json.js";
import { beginStage, finishStage } from "../server/lib/pipeline-ops.js";
import { latestAudit, loadDossier, loadVideo, saveAudit, saveScript, saveStages } from "../server/lib/store.js";

export default defineAction({
  description:
    "Script agent: save the narration script (hook, beats, lines). Rules: hook ≤ 12 words with no greeting; one sentence per line, ≤ 22 words; every factual line lists the dossier factIds it relies on; total words within ±10% of targetSeconds × wpm / 60. Claims are audited immediately and the result is returned.",
  schema: z.object({ videoId: z.string(), script: scriptSchema, note: z.string().max(300).default("") }),
  run: async ({ videoId, script, note }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    await beginStage(video, "script");
    const version = await saveScript(video, script, note || "Script draft");
    // Anything downstream of the script is now stale.
    video.stages = invalidateFrom(video.stages, "qa", nowIso());
    await saveStages(videoId, video.stages);

    const dossier = await loadDossier(videoId);
    const audit = dossier ? auditClaims({ script, dossier, scriptVersion: version, previous: (await latestAudit(videoId))?.results ?? [] }) : null;
    if (audit) await saveAudit(video, audit);
    const status = await finishStage(video, "script", { note: `Version ${version}: ${scriptWordCount(script)} of ${wordBudget(script)} words` });
    return {
      version,
      status,
      words: scriptWordCount(script),
      budget: wordBudget(script),
      audit: audit ? { ...audit.counts, flagged: audit.results.filter((result) => result.verdict !== "supported").map((result) => ({ lineId: result.lineId, verdict: result.verdict, suggestion: result.suggestion })) } : "No dossier yet — claims can't be checked.",
    };
  },
});
