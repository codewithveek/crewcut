import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { isAdmin, planOf, workspaceOf } from "../server/lib/catalog.js";
import { identity } from "../server/lib/identity.js";

export default defineAction({
  description: "Whether the person is a Crewcut catalog admin, and their workspace's plan (free or pro).",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_input, ctx) => {
    const who = identity(ctx);
    const workspace = workspaceOf(who);
    return { admin: isAdmin(who), workspace, plan: await planOf(workspace) };
  },
});
