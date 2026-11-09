import { defineEventHandler, readRawBody } from "h3";

import { BillingError, verifyWebhook } from "../../../lib/billing/bachs.js";
import { handleBachsEvent } from "../../../lib/billing/webhooks.js";

/**
 * Bachs webhooks (register https://<app>/api/billing/webhook in the Bachs
 * developer portal). Public on purpose: the signature, checked against the
 * raw body before anything is parsed, is the authentication.
 *
 * 2xx = applied (or already applied). 401/400 = not from Bachs or malformed
 * (Bachs doesn't retry those). 500 = we failed to apply it, so Bachs retries.
 */
export default defineEventHandler(async (event) => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const raw = (await readRawBody(event, "utf8")) ?? "";
  if (raw.length > 512 * 1024) return json(413, { error: "too large" });

  let bachsEvent;
  try {
    bachsEvent = verifyWebhook(raw, event.req.headers, process.env.BACHS_WEBHOOK_SECRET);
  } catch (error) {
    const status = error instanceof BillingError ? error.statusCode : 400;
    console.warn(`[billing] Refused a webhook delivery: ${error instanceof Error ? error.message : error}`);
    return json(status, { error: status === 503 ? "not configured" : "invalid" });
  }

  try {
    const outcome = await handleBachsEvent(bachsEvent);
    return json(200, { received: true, duplicate: outcome.duplicate });
  } catch (error) {
    console.error(`[billing] Could not apply ${bachsEvent.type} ${bachsEvent.id}:`, error);
    return json(500, { error: "could not apply" });
  }
});
