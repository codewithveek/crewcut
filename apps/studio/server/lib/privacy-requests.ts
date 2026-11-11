import { isEmailConfigured, sendEmail } from "@agent-native/core/server";
import { sql } from "drizzle-orm";

import { getDb } from "../db/index.js";

/**
 * People's "send me a copy of my data" and "delete my data" requests
 * (Settings → Security). The framework only records them as a pending flag in
 * the person's settings; nobody was told. This lists them for the admin page
 * and emails the operator once per request, so the answer the Privacy Policy
 * promises doesn't depend on someone remembering to look.
 */

const REQUESTS_SUFFIX = ":privacy-rights-requests";
const NOTIFIED_KEY = "crewcut:privacy-requests-notified";

export type PrivacyRequestType = "access" | "deletion";

export interface PrivacyRequest {
  email: string;
  type: PrivacyRequestType;
  requestedAt: string;
}

const rowsOf = (result: unknown) => (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{ key?: unknown; value?: unknown }>;

function parse(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Every request still waiting, oldest first. */
export async function listPrivacyRequests(): Promise<PrivacyRequest[]> {
  const rows = rowsOf(await getDb().execute(sql`select key, value from public.settings where key like ${`u:%${REQUESTS_SUFFIX}`}`));
  const requests: PrivacyRequest[] = [];
  for (const row of rows) {
    const key = String(row.key ?? "");
    const email = key.slice(2, key.length - REQUESTS_SUFFIX.length);
    const stored = parse(row.value);
    for (const type of ["access", "deletion"] as const) {
      const entry = stored[type] as { status?: unknown; requestedAt?: unknown } | undefined;
      if (entry?.status !== "pending" || typeof entry.requestedAt !== "number") continue;
      requests.push({ email, type, requestedAt: new Date(entry.requestedAt).toISOString() });
    }
  }
  return requests.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/** Clears a request once the operator has answered it (sent the copy, or deleted the data). */
export async function resolvePrivacyRequest(email: string, type: PrivacyRequestType): Promise<boolean> {
  const key = `u:${email.trim().toLowerCase()}${REQUESTS_SUFFIX}`;
  const [row] = rowsOf(await getDb().execute(sql`select key, value from public.settings where key = ${key}`));
  if (!row) return false;
  const stored = parse(row.value);
  if (!stored[type]) return false;
  delete stored[type];
  await getDb().execute(sql`update public.settings set value = ${JSON.stringify(stored)}, updated_at = ${Date.now()} where key = ${key}`);
  return true;
}

const operatorEmail = () => process.env.CREWCUT_PRIVACY_EMAIL?.trim() || process.env.CREWCUT_SUPPORT_EMAIL?.trim() || "support@getcrewcut.app";

/** Emails the operator about requests they haven't been told about yet. Returns how many were new. */
export async function notifyNewPrivacyRequests(): Promise<number> {
  const pending = await listPrivacyRequests();
  if (pending.length === 0) return 0;
  const db = getDb();
  const [row] = rowsOf(await db.execute(sql`select key, value from public.settings where key = ${NOTIFIED_KEY}`));
  const notified = parse(row?.value);
  const idOf = (request: PrivacyRequest) => `${request.email}|${request.type}|${request.requestedAt}`;
  const fresh = pending.filter((request) => !notified[idOf(request)]);
  if (fresh.length === 0) return 0;

  const lines = fresh.map((request) => `${request.type === "deletion" ? "Delete my data" : "Send me a copy of my data"}: ${request.email} (asked ${request.requestedAt.slice(0, 10)})`);
  console.warn(`[privacy] ${fresh.length} new data request(s) need an answer:\n  ${lines.join("\n  ")}`);
  if (await Promise.resolve(isEmailConfigured()).catch(() => false)) {
    const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
    await sendEmail({
      to: operatorEmail(),
      subject: `Crewcut: ${fresh.length} data request${fresh.length === 1 ? "" : "s"} to answer`,
      text: `${lines.join("\n")}\n\nAnswer within 30 days, then mark each one done in Admin → Data requests.`,
      html: `<p>${lines.map(escape).join("<br>")}</p><p>Answer within 30 days, then mark each one done in Admin → Data requests.</p>`,
      useDeploymentCredentials: true,
    });
  }
  // Only what is still pending is remembered, so the list can't grow for ever.
  const next = Object.fromEntries(pending.map((request) => [idOf(request), true]));
  await db.execute(sql`insert into public.settings (key, value, updated_at) values (${NOTIFIED_KEY}, ${JSON.stringify(next)}, ${Date.now()}) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`);
  return fresh.length;
}
