import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireAdmin } from "../server/lib/catalog.js";
import { UserError } from "../server/lib/errors.js";
import { requireHuman } from "../server/lib/identity.js";
import { listPrivacyRequests, resolvePrivacyRequest } from "../server/lib/privacy-requests.js";

export default defineAction({
  description:
    "Admins (people only): the data requests people made in Settings (a copy of their data, or deletion) that are still waiting for an answer. Pass resolve with the person's email and the request type to mark one as answered once it has been done.",
  schema: z.object({
    resolve: z.object({ email: z.string().email(), type: z.enum(["access", "deletion"]) }).optional(),
  }),
  // Other people's email addresses: never the agent, MCP or a mini-app.
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ resolve }, ctx) => {
    requireAdmin(ctx);
    requireHuman(ctx, "Handling data requests");
    if (resolve && !(await resolvePrivacyRequest(resolve.email, resolve.type))) throw new UserError("That request isn't waiting any more.", 404);
    return { requests: await listPrivacyRequests() };
  },
});
