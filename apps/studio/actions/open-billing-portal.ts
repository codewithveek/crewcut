import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { createPortalSession } from "../server/lib/billing/bachs.js";
import { workspaceOf } from "../server/lib/catalog.js";
import { UserError } from "../server/lib/errors.js";
import { requireHuman, requireWorkspaceManager } from "../server/lib/identity.js";

export default defineAction({
  description: "Open the Bachs billing portal for the person's workspace (people only): change or cancel the plan, update the card, see payments. Returns a short-lived link.",
  schema: z.object({}),
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async (_input, ctx) => {
    const who = requireHuman(ctx, "Managing billing");
    await requireWorkspaceManager(who, "Managing billing");
    const [customer] = await getDb().select({ customerId: schema.billingCustomers.customerId }).from(schema.billingCustomers).where(eq(schema.billingCustomers.workspace, workspaceOf(who))).limit(1);
    if (!customer) throw new UserError("This workspace hasn't paid for anything yet, so there's no billing account to manage.", 404);
    const session = await createPortalSession(customer.customerId);
    if (!/^https:\/\//.test(session.url)) throw new UserError("The payment service returned an unexpected link.", 502);
    return { url: session.url };
  },
});
