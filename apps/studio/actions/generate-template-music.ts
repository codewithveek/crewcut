import { defineAction } from "@agent-native/core/action";
import { TEMPLATES, getTemplate } from "@crewcut/composition";
import { z } from "zod";

import { requireHuman } from "../server/lib/identity.js";
import { generateTemplateMusic } from "../server/lib/templates.js";
import { UserError } from "../server/lib/errors.js";
import { requireAdmin } from "../server/lib/catalog.js";

/**
 * People-only: spends the workspace's ElevenLabs music allowance. Generates
 * each template's music bed once (shared by every project made from it);
 * force regenerates. Hidden from the agent, MCP and mini-apps.
 */
export default defineAction({
  description: "Generate the music bed for one template or every template that has none yet (ElevenLabs; people only).",
  schema: z.object({ templateId: z.string().optional(), force: z.boolean().default(false) }),
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ templateId, force }, ctx) => {
    // Spends the operator's ElevenLabs plan and replaces music every user shares: admins only.
    requireAdmin(ctx);
    requireHuman(ctx, "Generating template music");
    const targets = templateId ? [getTemplate(templateId)].filter((entry) => entry !== null) : [...TEMPLATES];
    if (targets.length === 0) throw new UserError(`No template "${templateId}"`);
    const results: Array<{ templateId: string; generated: boolean; bytes: number; durationMs: number; error?: string }> = [];
    // One at a time: generation is slow and the plan's allowance is shared.
    for (const template of targets) {
      try {
        const result = await generateTemplateMusic(template, { force });
        results.push({ templateId: template.id, generated: result.generated, bytes: result.bytes, durationMs: result.durationMs });
      } catch (error) {
        results.push({ templateId: template.id, generated: false, bytes: 0, durationMs: 0, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { results };
  },
});
