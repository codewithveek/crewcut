import { getOrgContext } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { sql } from "drizzle-orm";
import { defineEventHandler } from "h3";

import { getDb } from "../db/index.js";
import { planFor } from "../lib/plan-limits.js";

/**
 * Seats: how many people a workspace's plan includes (Free and Creator one,
 * Studio five). Inviting goes through the framework's own route, so the limit
 * is checked here, in front of it: people already in the workspace plus
 * invitations still waiting, plus the ones being sent now, must fit the plan.
 */
const INVITE_ROUTE = /\/_agent-native\/org\/invitations\/?$/;

const rowsOf = (result: unknown) => (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;

export default defineEventHandler(async (event) => {
  if (event.req.method !== "POST" || !INVITE_ROUTE.test(event.url.pathname)) return;
  let org: Awaited<ReturnType<typeof getOrgContext>>;
  try {
    org = await getOrgContext(event);
  } catch {
    return; // not signed in or no workspace: the route itself answers that
  }
  if (!org.orgId || !org.email) return;
  const orgId = org.orgId;

  // How many are being invited now, read from a copy so the route still gets its body.
  let inviting = 1;
  try {
    const body = (await event.req.clone().json()) as { emails?: unknown; email?: unknown };
    if (Array.isArray(body.emails)) inviting = Math.max(1, body.emails.filter((entry) => typeof entry === "string" && entry.trim()).length);
  } catch {
    // An unreadable body is the route's to refuse.
  }

  try {
    const { seats, name, taken } = await runWithRequestContext({ userEmail: org.email, orgId }, async () => {
      const plan = await planFor({ email: org.email, orgId });
      const [row] = rowsOf(
        await getDb().execute(sql`
          select (select count(*) from org_members where org_id = ${orgId})
               + (select count(*) from org_invitations where org_id = ${orgId} and status = 'pending') as taken`),
      );
      return { seats: plan.seats, name: plan.name, taken: Number(row?.taken ?? 0) };
    });
    if (taken + inviting <= seats) return;
    const message =
      seats <= 1
        ? `${name} is for one person. Studio has room for 5: upgrade on Plan & credits to invite your team.`
        : `${name} includes ${seats} people, and this workspace already has ${taken} (counting invitations still waiting). Remove someone or cancel an invitation first.`;
    return new Response(JSON.stringify({ error: message, message, statusMessage: message, errorCode: "upgrade:seats" }), { status: 402, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) {
    // Never block inviting because the count couldn't be read.
    console.error("[seats] could not check the plan's seats:", error instanceof Error ? error.message : error);
    return;
  }
});
