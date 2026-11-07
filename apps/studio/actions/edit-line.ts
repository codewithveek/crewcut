import { defineAction } from "@agent-native/core/action";
import { auditClaims } from "@crewcut/claim-audit";
import { scriptSchema } from "@crewcut/contracts";
import { z } from "zod";

import { latestAudit, latestScript, loadDossier, loadVideo, saveAudit, saveScript } from "../server/lib/store.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description: "Edit one script line (text, cited facts, emphasis or on-screen text). Saves a new script version and re-audits the claims.",
  schema: z.object({
    videoId: z.string(),
    lineId: z.string(),
    text: z.string().min(1).max(240).optional(),
    factIds: z.array(z.string()).optional(),
    emphasis: z.array(z.string().max(40)).max(3).optional(),
    onScreen: z.string().max(120).nullable().optional(),
  }),
  run: async (args, ctx) => {
    const video = await loadVideo(args.videoId, ctx, "editor");
    const current = await latestScript(args.videoId);
    if (!current) throw new UserError("No script yet.");
    const script = structuredClone(current.script);
    const line = script.beats.flatMap((beat) => beat.lines).find((candidate) => candidate.id === args.lineId);
    if (!line) throw new UserError(`No line ${args.lineId}`);
    if (args.text !== undefined) {
      line.text = args.text;
      delete line.say;
    }
    if (args.factIds !== undefined) line.factIds = args.factIds;
    if (args.emphasis !== undefined) line.emphasis = args.emphasis;
    if (args.onScreen === null) delete line.onScreen;
    else if (args.onScreen !== undefined) line.onScreen = args.onScreen;
    const version = await saveScript(video, scriptSchema.parse(script), `Edit ${args.lineId}`);
    const dossier = await loadDossier(args.videoId);
    if (dossier) {
      const audit = auditClaims({ script, dossier, scriptVersion: version, previous: (await latestAudit(args.videoId))?.results ?? [] });
      await saveAudit(video, audit);
      const result = audit.results.find((candidate) => candidate.lineId === args.lineId);
      return { version, line, verdict: result?.verdict ?? "not a claim", suggestion: result?.suggestion };
    }
    return { version, line };
  },
});
