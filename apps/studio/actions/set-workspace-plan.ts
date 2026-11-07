import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireAdmin } from "../server/lib/catalog.js";
import { requireHuman } from "../server/lib/identity.js";
import { nowIso } from "../server/lib/json.js";

export default defineAction({
  description: "Admins (people only): give a workspace Pro or move it back to Free. A workspace is an organisation id, or a person's email for their personal workspace.",
  schema: z.object({
    workspace: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .transform((value) => (value.includes("@") && !value.startsWith("user:") ? `user:${value.toLowerCase()}` : value)),
    plan: z.enum(["free", "pro"]),
    note: z.string().trim().max(200).optional(),
  }),
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ workspace, plan, note }, ctx) => {
    const who = requireAdmin(ctx);
    requireHuman(ctx, "Changing a workspace's plan");
    const values = { plan, source: "manual", note: note ?? "", updatedBy: who.email, updatedAt: nowIso() };
    await getDb().insert(schema.workspacePlans).values({ workspace, ...values }).onConflictDoUpdate({ target: schema.workspacePlans.workspace, set: values });
    return { workspace, plan };
  },
});
