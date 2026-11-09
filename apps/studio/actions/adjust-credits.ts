import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireAdmin } from "../server/lib/catalog.js";
import { adjustCredits } from "../server/lib/credits.js";
import { requireHuman } from "../server/lib/identity.js";

export default defineAction({
  description:
    "Admins (people only): give a workspace AI credits, or take some away (negative). A workspace is an organisation id, or a person's email for their personal workspace. Given credits last 12 months.",
  schema: z.object({
    workspace: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .transform((value) => (value.includes("@") && !value.startsWith("user:") ? `user:${value.toLowerCase()}` : value)),
    credits: z
      .number()
      .int()
      .min(-100_000)
      .max(100_000)
      .refine((value) => value !== 0, "Give or take at least one credit."),
    note: z.string().trim().min(2).max(200),
  }),
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ workspace, credits, note }, ctx) => {
    const who = requireAdmin(ctx);
    requireHuman(ctx, "Changing a workspace's credits");
    return adjustCredits(workspace, credits, note, who.email);
  },
});
