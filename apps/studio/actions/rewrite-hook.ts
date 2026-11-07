import { defineAction } from "@agent-native/core/action";
import { countWords } from "@crewcut/contracts";
import { z } from "zod";

import { latestScript, loadVideo, saveScript } from "../server/lib/store.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description:
    "Replace the hook (first line of the first beat). A good hook is ≤ 12 words, lands in under 3 seconds, and is a direct question, an imperative, or the surprising claim itself — never a greeting.",
  schema: z.object({ videoId: z.string(), text: z.string().min(3).max(140), emphasis: z.array(z.string()).max(2).default([]) }),
  run: async ({ videoId, text, emphasis }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const current = await latestScript(videoId);
    const hook = current?.script.beats[0]?.lines[0];
    if (!current || !hook) throw new UserError("No script yet.");
    const script = structuredClone(current.script);
    const line = script.beats[0]?.lines[0];
    if (!line) throw new UserError("The script has no hook line.");
    line.text = text;
    line.emphasis = emphasis;
    delete line.say;
    const version = await saveScript(video, script, "Rewrite hook");
    return { version, hook: text, words: countWords(text), warning: countWords(text) > 12 ? "Over 12 words — consider cutting." : undefined };
  },
});
