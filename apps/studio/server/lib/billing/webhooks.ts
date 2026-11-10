import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { getDb, schema } from "../../db/index.js";
import { addTopUp, ensureBalance, syncSubscriptionPeriod, useCalendarPeriod } from "../credits.js";
import { nowIso, toJson } from "../json.js";
import { normalizePlan, PLANS, TOP_UPS } from "../plans.js";
import { type BachsEvent, bachsRequest, itemForProduct } from "./bachs.js";

/**
 * Applies Bachs webhook events. Each event is stored first (Bachs delivers
 * at least once), applied, then marked processed; a repeat delivery of a
 * processed event changes nothing. Plans come from subscription events, and
 * paid top-ups from `collection.succeeded` (the docs' rule: fulfil from the
 * payment, not the browser redirect). Renewals arrive as `invoice.paid`: the
 * subscription is then read back from Bachs, and its new billing period
 * resets the workspace's credits.
 */

const ENTITLED = new Set(["active", "trialing", "past_due"]);

type Data = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const obj = (value: unknown): Data => (value && typeof value === "object" ? (value as Data) : {});

function customerIdOf(data: Data): string | undefined {
  const customer = obj(data.customer);
  return str(customer.customer_id) ?? str(customer.id) ?? str(data.customer_id);
}

async function workspaceFor(data: Data): Promise<string | undefined> {
  const fromMetadata = str(obj(data.metadata).workspace);
  if (fromMetadata) return fromMetadata;
  const customerId = customerIdOf(data);
  if (!customerId) return undefined;
  const [row] = await getDb().select({ workspace: schema.billingCustomers.workspace }).from(schema.billingCustomers).where(eq(schema.billingCustomers.customerId, customerId)).limit(1);
  return row?.workspace;
}

async function rememberCustomer(workspace: string, data: Data): Promise<void> {
  const customerId = customerIdOf(data);
  if (!customerId) return;
  const email = str(obj(data.customer).email) ?? "";
  await getDb()
    .insert(schema.billingCustomers)
    .values({ workspace, customerId, email, createdAt: nowIso() })
    .onConflictDoUpdate({ target: schema.billingCustomers.workspace, set: { customerId, ...(email ? { email } : {}) } });
}

async function setWorkspacePlan(workspace: string, plan: string, note: string): Promise<void> {
  const values = { plan, source: "bachs", note, updatedBy: "bachs", updatedAt: nowIso() };
  await getDb().insert(schema.workspacePlans).values({ workspace, ...values }).onConflictDoUpdate({ target: schema.workspacePlans.workspace, set: values });
  await ensureBalance(workspace); // follows the plan change: an upgrade's extra credits arrive now
}

/** The plan a workspace's live subscriptions give it (the best one), or Free. */
async function planFromSubscriptions(workspace: string): Promise<string> {
  const rows = await getDb().select({ plan: schema.billingSubscriptions.plan, status: schema.billingSubscriptions.status }).from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.workspace, workspace));
  const live = rows.filter((row) => ENTITLED.has(row.status)).map((row) => normalizePlan(row.plan));
  if (live.includes("studio")) return "studio";
  if (live.includes("creator")) return "creator";
  return "free";
}

/** The product of a subscription, wherever Bachs puts it (events: product_id; the API: product.id or the item's price). */
function productIdOf(data: Data): string | undefined {
  const item = obj((data.items as unknown[] | undefined)?.[0]);
  return str(data.product_id) ?? str(obj(data.product).id) ?? str(obj(item.price).product_id) ?? str(item.product_id) ?? str(obj(item.product).id);
}

async function applySubscription(event: BachsEvent, deleted: boolean): Promise<string> {
  const data = event.data;
  const subscriptionId = str(data.subscription_id) ?? str(obj(data.subscription).subscription_id) ?? str(data.id);
  if (!subscriptionId) return "no subscription id";
  const workspace = await workspaceFor(data);
  if (!workspace) return `subscription ${subscriptionId}: no workspace (metadata.workspace or a known customer)`;
  await rememberCustomer(workspace, data);

  const productId = productIdOf(data);
  const mapped = itemForProduct(productId);
  const plan = mapped && !mapped.item.startsWith("topup-") ? mapped.item : normalizePlan(str(obj(data.metadata).plan));
  if (plan === "free") return `subscription ${subscriptionId}: product ${productId ?? "?"} isn't a Crewcut plan`;
  const interval = mapped?.interval ?? (str(obj(data.billing_cycle).interval) === "year" ? "year" : "month");
  const status = deleted ? "canceled" : (str(data.status) ?? "active");

  const values = {
    workspace,
    plan,
    billingInterval: interval,
    status,
    productId: productId ?? "",
    currentPeriodEnd: str(data.current_period_end) ?? null,
    cancelAtPeriodEnd: data.cancel_at_period_end === true,
    updatedAt: nowIso(),
  };
  await getDb().insert(schema.billingSubscriptions).values({ id: subscriptionId, ...values }).onConflictDoUpdate({ target: schema.billingSubscriptions.id, set: values });

  const next = await planFromSubscriptions(workspace);
  await setWorkspacePlan(workspace, next, `Bachs subscription ${subscriptionId} (${status})`);
  // Credits follow the billing period while the plan is paid; back on Free they refill monthly on their own.
  let period = "";
  if (next === "free") await useCalendarPeriod(workspace);
  else if (ENTITLED.has(status)) {
    const outcome = await syncSubscriptionPeriod(workspace, str(data.current_period_start), str(data.current_period_end));
    period = outcome === "renewed" ? ", credits renewed" : outcome === "aligned" ? ", period follows billing" : "";
  }
  return `${workspace} → ${PLANS[normalizePlan(next)].name} (subscription ${status}${period})`;
}

/** A paid invoice (the first payment or a renewal): read the subscription back from Bachs and apply it. */
async function applyInvoicePaid(event: BachsEvent): Promise<string> {
  const subscriptionId = str(obj(event.data.subscription).subscription_id) ?? str(event.data.subscription_id);
  if (!subscriptionId) return "invoice without a subscription";
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(subscriptionId)) return `invoice for an unexpected subscription id`;
  const subscription = await bachsRequest<Data>("GET", `/v1/subscriptions/${subscriptionId}`);
  // The invoice's customer and metadata help find the workspace if the subscription lacks them.
  const data: Data = { ...subscription, subscription_id: subscriptionId, metadata: { ...obj(event.data.metadata), ...obj(subscription.metadata) }, customer: { ...obj(event.data.customer), ...obj(subscription.customer) } };
  if (!str(data.current_period_start)) data.current_period_start = event.data.period_start;
  if (!str(data.current_period_end)) data.current_period_end = event.data.period_end;
  return applySubscription({ ...event, data }, false);
}

async function applyPayment(event: BachsEvent): Promise<string> {
  const data = event.data;
  const checkoutId = str(data.checkout_id);
  const db = getDb();
  const [checkout] = checkoutId ? await db.select().from(schema.billingCheckouts).where(eq(schema.billingCheckouts.sessionId, checkoutId)).limit(1) : [];
  const workspace = checkout?.workspace ?? (await workspaceFor(data));
  if (workspace) await rememberCustomer(workspace, data);

  // Which top-up was bought: our checkout record, else the product in the cart.
  const cart = Array.isArray(data.product_cart) ? (data.product_cart as unknown[]) : [];
  const fromCart = cart.map((line) => itemForProduct(str(obj(line).product_id))).find((item) => item?.item.startsWith("topup-"));
  const topUpId = checkout?.kind === "topup" ? checkout.item : fromCart?.item;
  const topUp = TOP_UPS.find((pack) => pack.id === topUpId);

  if (checkout) await db.update(schema.billingCheckouts).set({ status: "completed", completedAt: nowIso() }).where(eq(schema.billingCheckouts.id, checkout.id));
  if (!topUp) return checkout ? `checkout ${checkout.id} paid (${checkout.kind})` : "payment for something other than a top-up";
  if (!workspace) return `top-up paid but no workspace for checkout ${checkoutId ?? "?"}`;

  const paymentRef = `bachs:${str(data.charge_id) ?? checkoutId ?? event.id}`;
  const added = await addTopUp(workspace, topUp.credits, paymentRef, `${topUp.credits} credits bought`);
  return added ? `${workspace} +${topUp.credits} credits` : `${workspace}: top-up ${paymentRef} already added`;
}

async function applyCheckoutEnded(event: BachsEvent, status: "completed" | "expired"): Promise<string> {
  const checkoutId = str(event.data.checkout_id) ?? str(event.data.id);
  if (!checkoutId) return "no checkout id";
  await getDb()
    .update(schema.billingCheckouts)
    .set({ status, ...(status === "completed" ? { completedAt: nowIso() } : {}) })
    .where(and(eq(schema.billingCheckouts.sessionId, checkoutId), ne(schema.billingCheckouts.status, "completed")));
  return `checkout ${checkoutId} ${status}`;
}

export async function handleBachsEvent(event: BachsEvent): Promise<{ duplicate: boolean; result: string }> {
  const db = getDb();
  const inserted = await db.insert(schema.billingEvents).values({ id: event.id, type: event.type, payload: toJson(event), receivedAt: nowIso() }).onConflictDoNothing().returning({ id: schema.billingEvents.id });
  if (inserted.length === 0) {
    const [existing] = await db.select({ processedAt: schema.billingEvents.processedAt }).from(schema.billingEvents).where(eq(schema.billingEvents.id, event.id)).limit(1);
    if (existing?.processedAt) return { duplicate: true, result: "already applied" };
  }

  try {
    let result: string;
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        result = await applySubscription(event, false);
        break;
      case "customer.subscription.deleted":
        result = await applySubscription(event, true);
        break;
      case "collection.succeeded":
        result = await applyPayment(event);
        break;
      case "invoice.paid":
        result = await applyInvoicePaid(event);
        break;
      case "checkout.completed":
        result = await applyCheckoutEnded(event, "completed");
        break;
      case "checkout.expired":
        result = await applyCheckoutEnded(event, "expired");
        break;
      default:
        result = "not used by Crewcut";
    }
    await db.update(schema.billingEvents).set({ processedAt: nowIso(), error: null }).where(eq(schema.billingEvents.id, event.id));
    console.log(`[billing] ${event.type} ${event.id}: ${result}`);
    return { duplicate: false, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(schema.billingEvents).set({ error: message.slice(0, 500) }).where(eq(schema.billingEvents.id, event.id));
    throw error;
  }
}

/** Admin view: the latest webhook events and any that failed. */
export async function recentBillingEvents(limit = 30) {
  return getDb().select({ id: schema.billingEvents.id, type: schema.billingEvents.type, receivedAt: schema.billingEvents.receivedAt, processedAt: schema.billingEvents.processedAt, error: schema.billingEvents.error }).from(schema.billingEvents).orderBy(desc(schema.billingEvents.receivedAt)).limit(limit);
}

export async function activeSubscription(workspace: string) {
  const [row] = await getDb()
    .select()
    .from(schema.billingSubscriptions)
    .where(and(eq(schema.billingSubscriptions.workspace, workspace), inArray(schema.billingSubscriptions.status, [...ENTITLED])))
    .orderBy(desc(schema.billingSubscriptions.updatedAt))
    .limit(1);
  return row ?? null;
}
