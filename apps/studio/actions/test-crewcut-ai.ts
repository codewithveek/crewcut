import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createCrewcutAiEngine } from "../server/lib/ai/engine.js";
import { costMicros } from "../server/lib/ai/models.js";
import { recordAiUsage } from "../server/lib/ai/usage.js";
import { requireAdmin } from "../server/lib/catalog.js";
import { UserError } from "../server/lib/errors.js";
import { requireHuman } from "../server/lib/identity.js";

export default defineAction({
  description: "Admins (people only): send one short test prompt to a Crewcut AI model through Cloudflare AI Gateway and report the reply, time and cost.",
  schema: z.object({ model: z.string().trim().max(120).optional() }),
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ model }, ctx) => {
    const who = requireAdmin(ctx);
    requireHuman(ctx, "Testing Crewcut AI");
    const built = createCrewcutAiEngine(model);
    if (!built) throw new UserError("Crewcut AI isn't set up: add the Cloudflare AI Gateway settings first.");
    const started = Date.now();
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let text = "";
    let error: string | undefined;
    try {
      for await (const event of built.engine.stream({
        model: built.model.id,
        systemPrompt: "You are checking that a connection works. Answer in one short sentence.",
        messages: [{ role: "user", content: [{ type: "text", text: "Say that Crewcut AI is working." }] }],
        tools: [],
        abortSignal: AbortSignal.timeout(60_000),
        maxOutputTokens: 400,
      })) {
        if (event.type === "text-delta") text += event.text;
        if (event.type === "usage") Object.assign(usage, { inputTokens: event.inputTokens, outputTokens: event.outputTokens, cacheReadTokens: event.cacheReadTokens ?? 0, cacheWriteTokens: event.cacheWriteTokens ?? 0 });
        if (event.type === "stop" && event.reason === "error") error = event.error ?? "The model returned an error.";
      }
    } catch (caught) {
      error ??= caught instanceof Error ? caught.message : String(caught);
    }
    const cost = costMicros(built.model, usage);
    await recordAiUsage({ ownerEmail: who.email, orgId: who.orgId, source: "managed", kind: "llm", provider: built.model.provider, model: built.model.id, ...usage, costMicros: cost, stage: "check", durationMs: Date.now() - started, error });
    return { ok: !error && text.trim().length > 0, model: built.model.id, provider: built.model.provider, reply: text.trim().slice(0, 300), error: error?.slice(0, 500) ?? null, ms: Date.now() - started, usage, costUsd: cost / 1_000_000 };
  },
});
