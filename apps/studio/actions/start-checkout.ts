import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { billingReady, createCheckoutSession, productIdFor } from "../server/lib/billing/bachs.js";
import { activeSubscription } from "../server/lib/billing/webhooks.js";
import { workspaceOf } from "../server/lib/catalog.js";
import { UserError } from "../server/lib/errors.js";
import { requireHuman } from "../server/lib/identity.js";
import { nowIso } from "../server/lib/json.js";
import { PLANS } from "../server/lib/plans.js";
import { newId } from "../server/lib/storage.js";
import { appOrigin } from "../server/lib/vault.js";

/** Where Bachs sends people back: the configured app URL, or loopback in development. */
function returnOrigin(origin: string | undefined): string {
  const configured = new URL(appOrigin()).origin;
  if (!origin) return configured;
  const url = new URL(origin);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.origin === configured || (loopback && process.env.NODE_ENV !== "production")) return url.origin;
  throw new UserError("That address isn't allowed for payments.");
}

export default defineAction({
  description: "Start paying for Creator or Studio (monthly or yearly), or buy a credit top-up (people only). Returns the Bachs checkout link the browser goes to.",
  schema: z.object({
    item: z.enum(["creator", "studio", "topup-300", "topup-1000"]),
    interval: z.enum(["month", "year"]).default("month"),
    origin: z.string().url().optional(),
  }),
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ item, interval, origin }, ctx) => {
    const who = requireHuman(ctx, "Paying for Crewcut");
    const isTopUp = item.startsWith("topup-");
    const ready = billingReady();
    if (isTopUp ? !ready.topUps : !ready.subscriptions) throw new UserError("Payments aren't switched on yet. Check back soon.", 503);

    const workspace = workspaceOf(who);
    if (!isTopUp) {
      const current = await activeSubscription(workspace);
      if (current) throw new UserError(`This workspace already has ${PLANS[current.plan as "creator" | "studio"]?.name ?? "a paid plan"}. Change or cancel it from Manage billing.`, 409);
    }
    const productId = productIdFor(item, interval);
    if (!productId) throw new UserError("That plan isn't on sale right now.", 503);

    const db = getDb();
    const [customer] = await db.select({ customerId: schema.billingCustomers.customerId }).from(schema.billingCustomers).where(eq(schema.billingCustomers.workspace, workspace)).limit(1);
    const base = returnOrigin(origin);
    const id = newId("chk");
    await db.insert(schema.billingCheckouts).values({ id, workspace, kind: isTopUp ? "topup" : "subscription", item, billingInterval: isTopUp ? null : interval, status: "open", createdBy: who.email, createdAt: nowIso() });

    const session = await createCheckoutSession({
      productId,
      customer: customer ? { customer_id: customer.customerId } : { email: who.email },
      successUrl: `${base}/billing?checkout=done`,
      cancelUrl: `${base}/billing?checkout=cancelled`,
      metadata: { workspace, item, ...(isTopUp ? {} : { plan: item, interval }), checkout: id, person: who.email },
      reference: id,
    });
    await db.update(schema.billingCheckouts).set({ sessionId: session.checkout_id }).where(eq(schema.billingCheckouts.id, id));
    if (!/^https:\/\//.test(session.checkout_url)) throw new UserError("The payment service returned an unexpected link.", 502);
    return { url: session.checkout_url, checkoutId: session.checkout_id };
  },
});
