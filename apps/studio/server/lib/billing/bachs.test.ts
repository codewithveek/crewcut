import { describe, expect, it } from "vitest";

import { bachsBaseUrl, billingReady, createCheckoutSession, itemForProduct, productIdFor, signWebhook, verifyWebhook } from "./bachs.js";

const products = {
  BACHS_SECRET_KEY: "sk_sandbox_test",
  BACHS_WEBHOOK_SECRET: "whsec_test",
  BACHS_PRODUCT_CREATOR_MONTH: "prod_cm",
  BACHS_PRODUCT_CREATOR_YEAR: "prod_cy",
  BACHS_PRODUCT_STUDIO_MONTH: "prod_sm",
  BACHS_PRODUCT_STUDIO_YEAR: "prod_sy",
  BACHS_PRODUCT_TOPUP_300: "prod_t300",
  BACHS_PRODUCT_TOPUP_1000: "prod_t1000",
};

const headersOf = (record: Record<string, string>) => new Headers(record);

describe("Bachs settings", () => {
  it("uses the sandbox for sandbox keys and the live API for live keys", () => {
    expect(bachsBaseUrl({ BACHS_SECRET_KEY: "sk_sandbox_x" })).toBe("https://sandbox-api.bachs.io");
    expect(bachsBaseUrl({ BACHS_SECRET_KEY: "sk_live_x" })).toBe("https://api.bachs.io");
  });

  it("is ready only with a key, a webhook secret and every product", () => {
    expect(billingReady(products)).toEqual({ subscriptions: true, topUps: true, mode: "sandbox" });
    expect(billingReady({ ...products, BACHS_WEBHOOK_SECRET: "" }).subscriptions).toBe(false);
    expect(billingReady({ ...products, BACHS_PRODUCT_STUDIO_YEAR: "" })).toMatchObject({ subscriptions: false, topUps: true });
    expect(billingReady({}).mode).toBeNull();
  });

  it("maps plans and top-ups to products and back", () => {
    expect(productIdFor("studio", "year", products)).toBe("prod_sy");
    expect(productIdFor("topup-300", undefined, products)).toBe("prod_t300");
    expect(itemForProduct("prod_cm", products)).toEqual({ item: "creator", interval: "month" });
    expect(itemForProduct("prod_t1000", products)).toEqual({ item: "topup-1000" });
    expect(itemForProduct("prod_other", products)).toBeNull();
  });
});

describe("Bachs webhooks", () => {
  const body = JSON.stringify({ id: "evt_1", type: "collection.succeeded", created_at: "2026-11-09T12:00:00Z", data: { checkout_id: "chk_1" } });
  const now = 1_794_000_000;

  it("accepts a correctly signed delivery (V2 and the older headers)", () => {
    const signed = signWebhook(body, "whsec_test", now);
    expect(verifyWebhook(body, headersOf({ "x-bachs-signature-v2": signed["x-bachs-signature-v2"] }), "whsec_test", now).id).toBe("evt_1");
    expect(verifyWebhook(body, headersOf({ "x-bachs-timestamp": signed["x-bachs-timestamp"], "x-bachs-signature": signed["x-bachs-signature"] }), "whsec_test", now).type).toBe("collection.succeeded");
  });

  it("accepts either secret while rotating, and any of several v1 values", () => {
    const signed = signWebhook(body, "whsec_new", now);
    expect(() => verifyWebhook(body, headersOf({ "x-bachs-signature-v2": signed["x-bachs-signature-v2"] }), "whsec_old, whsec_new", now)).not.toThrow();
    const both = `t=${now},v1=${"0".repeat(64)},v1=${signed["x-bachs-signature"]}`;
    expect(() => verifyWebhook(body, headersOf({ "x-bachs-signature-v2": both }), "whsec_new", now)).not.toThrow();
  });

  it("refuses tampered bodies, wrong secrets, old timestamps and missing signatures", () => {
    const signed = signWebhook(body, "whsec_test", now);
    const header = headersOf({ "x-bachs-signature-v2": signed["x-bachs-signature-v2"] });
    expect(() => verifyWebhook(body.replace("chk_1", "chk_2"), header, "whsec_test", now)).toThrow(/doesn't match/);
    expect(() => verifyWebhook(body, header, "whsec_wrong", now)).toThrow(/doesn't match/);
    expect(() => verifyWebhook(body, header, "whsec_test", now + 301)).toThrow(/too old/);
    expect(() => verifyWebhook(body, headersOf({}), "whsec_test", now)).toThrow(/Missing/);
    expect(() => verifyWebhook(body, header, undefined, now)).toThrow(/secret isn't set/);
  });
});

describe("Bachs checkout", () => {
  it("sends the product, customer, return links and workspace metadata", async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify({ checkout_id: "chk_9", checkout_url: "https://checkout.bachs.io/c/x", status: "open" }), { status: 201 });
    }) as unknown as typeof fetch;
    const session = await createCheckoutSession(
      { productId: "prod_cm", customer: { email: "a@b.com" }, successUrl: "https://getcrewcut.app/billing?checkout=done", cancelUrl: "https://getcrewcut.app/billing", metadata: { workspace: "user:a@b.com", plan: "creator" }, reference: "chk_ours" },
      { fetchImpl, env: products },
    );
    expect(session.checkout_url).toBe("https://checkout.bachs.io/c/x");
    expect(sent?.url).toBe("https://sandbox-api.bachs.io/v1/checkout-sessions");
    expect(new Headers(sent?.init.headers).get("authorization")).toBe("Bearer sk_sandbox_test");
    expect(JSON.parse(String(sent?.init.body))).toMatchObject({ product_cart: [{ product_id: "prod_cm", quantity: 1 }], customer: { email: "a@b.com" }, billing_currency: "USD", metadata: { workspace: "user:a@b.com" }, reference: "chk_ours" });
  });

  it("explains refusals in plain words", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "customer is required" } }), { status: 400 })) as unknown as typeof fetch;
    await expect(createCheckoutSession({ productId: "p", customer: { email: "a@b.com" }, successUrl: "https://x", cancelUrl: "https://x", metadata: {}, reference: "r" }, { fetchImpl, env: products })).rejects.toThrow(/refused this: customer is required/);
  });
});
