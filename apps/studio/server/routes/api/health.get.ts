import { defineEventHandler } from "h3";

/**
 * A cheap "are you up" answer, public and without database work. The
 * Cloudflare Worker calls it once a day (see deploy/cloudflare): that wakes a
 * sleeping container, and waking is what starts the daily jobs that only run
 * while the server is up (the YouTube authorisation check the Privacy Policy
 * promises, closing interrupted exports, data-request notices).
 */
export default defineEventHandler(() => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "cache-control": "no-store" } }));
