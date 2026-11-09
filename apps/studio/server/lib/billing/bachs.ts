import { createHmac, timingSafeEqual } from "node:crypto";

import type { BillingInterval, PaidPlanId, TopUpId } from "../plans.js";

/**
 * Bachs (bachs.io): Crewcut's payments. Subscriptions for Creator and Studio
 * (monthly and yearly; Bachs bills subscriptions in USD by card) and one-time
 * credit top-ups. Crewcut stays the seller of record.
 *
 * Settings (server-only):
 * - BACHS_SECRET_KEY: sk_sandbox_… (sandbox API) or sk_live_… (live API).
 * - BACHS_WEBHOOK_SECRET: the endpoint's signing secret (comma-separate two
 *   while rotating).
 * - BACHS_PRODUCT_CREATOR_MONTH / _YEAR, BACHS_PRODUCT_STUDIO_MONTH / _YEAR,
 *   BACHS_PRODUCT_TOPUP_300 / _1000: product ids (prod_…). The setup script
 *   (pnpm billing:setup) creates the products and prints these lines.
 */

type Env = Record<string, string | undefined>;
const clean = (value: string | undefined) => value?.replace(/\r/g, "").trim() || undefined;

export type BillingItem = PaidPlanId | TopUpId;

export const PRODUCT_ENV: Record<string, string> = {
  "creator:month": "BACHS_PRODUCT_CREATOR_MONTH",
  "creator:year": "BACHS_PRODUCT_CREATOR_YEAR",
  "studio:month": "BACHS_PRODUCT_STUDIO_MONTH",
  "studio:year": "BACHS_PRODUCT_STUDIO_YEAR",
  "topup-300": "BACHS_PRODUCT_TOPUP_300",
  "topup-1000": "BACHS_PRODUCT_TOPUP_1000",
};

export function bachsKey(env: Env = process.env): string | undefined {
  return clean(env.BACHS_SECRET_KEY);
}

export function bachsBaseUrl(env: Env = process.env): string {
  const override = clean(env.BACHS_API_URL);
  if (override) return override.replace(/\/+$/, "");
  return bachsKey(env)?.startsWith("sk_live_") ? "https://api.bachs.io" : "https://sandbox-api.bachs.io";
}

export function productIdFor(item: BillingItem, interval?: BillingInterval, env: Env = process.env): string | undefined {
  const name = item.startsWith("topup-") ? PRODUCT_ENV[item] : PRODUCT_ENV[`${item}:${interval ?? "month"}`];
  return name ? clean(env[name]) : undefined;
}

/** Which plan (and billing interval) or top-up a Bachs product id is. */
export function itemForProduct(productId: string | undefined | null, env: Env = process.env): { item: BillingItem; interval?: BillingInterval } | null {
  if (!productId) return null;
  for (const [key, name] of Object.entries(PRODUCT_ENV)) {
    if (clean(env[name]) !== productId) continue;
    if (key.startsWith("topup-")) return { item: key as TopUpId };
    const [plan, interval] = key.split(":") as [PaidPlanId, BillingInterval];
    return { item: plan, interval };
  }
  return null;
}

export function billingReady(env: Env = process.env): { subscriptions: boolean; topUps: boolean; mode: "sandbox" | "live" | null } {
  const key = bachsKey(env);
  const webhook = Boolean(clean(env.BACHS_WEBHOOK_SECRET));
  const has = (names: string[]) => names.every((name) => Boolean(clean(env[name])));
  return {
    subscriptions: Boolean(key) && webhook && has(["BACHS_PRODUCT_CREATOR_MONTH", "BACHS_PRODUCT_CREATOR_YEAR", "BACHS_PRODUCT_STUDIO_MONTH", "BACHS_PRODUCT_STUDIO_YEAR"]),
    topUps: Boolean(key) && webhook && has(["BACHS_PRODUCT_TOPUP_300", "BACHS_PRODUCT_TOPUP_1000"]),
    mode: key ? (key.startsWith("sk_live_") ? "live" : "sandbox") : null,
  };
}

export class BillingError extends Error {
  override readonly name = "BillingError";
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function bachsRequest<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, options: { fetchImpl?: typeof fetch; env?: Env; idempotencyKey?: string } = {}): Promise<T> {
  const env = options.env ?? process.env;
  const key = bachsKey(env);
  if (!key) throw new BillingError("Payments aren't set up yet.", 503);
  const response = await (options.fetchImpl ?? fetch)(`${bachsBaseUrl(env)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text.slice(0, 300) };
  }
  if (!response.ok) {
    const record = (data ?? {}) as { message?: string; error?: { message?: string } | string };
    const detail = typeof record.error === "string" ? record.error : record.error?.message ?? record.message ?? response.statusText;
    console.error(`[billing] Bachs ${method} ${path} failed (${response.status}): ${detail}`);
    throw new BillingError(response.status >= 500 ? "The payment service isn't responding. Try again in a minute." : `The payment service refused this: ${detail}`, response.status >= 500 ? 502 : 400);
  }
  return data as T;
}

export interface CheckoutSession {
  checkout_id: string;
  checkout_url: string;
  status: string;
  expires_at?: string;
}

export async function createCheckoutSession(input: {
  productId: string;
  customer: { customer_id: string } | { email: string; name?: string };
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  reference: string;
}, options?: { fetchImpl?: typeof fetch; env?: Env }): Promise<CheckoutSession> {
  return bachsRequest<CheckoutSession>(
    "POST",
    "/v1/checkout-sessions",
    {
      product_cart: [{ product_id: input.productId, quantity: 1 }],
      customer: input.customer,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      billing_currency: "USD",
      metadata: input.metadata,
      reference: input.reference,
      expires_in_minutes: 60,
    },
    { ...options, idempotencyKey: input.reference },
  );
}

export async function createPortalSession(customerId: string, options?: { fetchImpl?: typeof fetch; env?: Env }): Promise<{ id: string; url: string }> {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(customerId)) throw new BillingError("That billing account isn't valid.");
  return bachsRequest<{ id: string; url: string }>("POST", `/v1/customers/${customerId}/portal-sessions`, undefined, options);
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export interface BachsEvent {
  id: string;
  type: string;
  created_at?: string;
  organization_id?: string;
  data: Record<string, unknown>;
}

const TOLERANCE_SECONDS = 300;

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * Checks a delivery's signature against the raw body before anything is
 * parsed. X-Bachs-Signature-V2 is `t=<unix seconds>,v1=<hex>[,v1=<hex>…]` (one
 * v1 per live secret while rotating); X-Bachs-Signature + X-Bachs-Timestamp is
 * the older form. The signature is HMAC-SHA256 over "<timestamp>.<raw body>".
 * Deliveries more than five minutes from now are refused (replays).
 */
export function verifyWebhook(rawBody: string, headers: { get(name: string): string | null }, secretsValue: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): BachsEvent {
  const secrets = (secretsValue ?? "").split(",").map((secret) => secret.trim()).filter(Boolean);
  if (secrets.length === 0) throw new BillingError("Webhook signing secret isn't set.", 503);

  let timestamp: string | null = null;
  let signatures: string[] = [];
  const v2 = headers.get("x-bachs-signature-v2");
  if (v2) {
    for (const part of v2.split(",")) {
      const [key, value] = part.split("=", 2).map((piece) => piece?.trim());
      if (key === "t" && value) timestamp = value;
      if (key === "v1" && value) signatures.push(value);
    }
  } else {
    timestamp = headers.get("x-bachs-timestamp");
    const single = headers.get("x-bachs-signature");
    if (single) signatures = [single.trim()];
  }
  if (!timestamp || !/^\d{9,11}$/.test(timestamp) || signatures.length === 0) throw new BillingError("Missing webhook signature.", 401);
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) throw new BillingError("Webhook timestamp is too old.", 401);

  const expected = secrets.map((secret) => createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
  if (!signatures.some((signature) => expected.some((candidate) => safeEqualHex(signature, candidate)))) throw new BillingError("Webhook signature doesn't match.", 401);

  const parsed = JSON.parse(rawBody) as Partial<BachsEvent>;
  if (typeof parsed.id !== "string" || typeof parsed.type !== "string" || !parsed.data || typeof parsed.data !== "object") throw new BillingError("Webhook body isn't an event.", 400);
  return parsed as BachsEvent;
}

/** Sign a body like Bachs does (tests, and the local webhook replay script). */
export function signWebhook(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): { "x-bachs-signature-v2": string; "x-bachs-timestamp": string; "x-bachs-signature": string } {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return { "x-bachs-signature-v2": `t=${timestamp},v1=${signature}`, "x-bachs-timestamp": String(timestamp), "x-bachs-signature": signature };
}
