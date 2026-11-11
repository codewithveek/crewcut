import type { ActionCaller, ActionRunContext } from "@agent-native/core/action";
import { sql } from "drizzle-orm";

import { getDb } from "../db/index.js";

/**
 * Who is acting. People act through the app UI or the local CLI; everything
 * else (the agent's tool calls, MCP, A2A, automations, raw HTTP) is an agent.
 * Approvals and overrides require a person — enforced here, not by prompt.
 */
export interface Identity {
  email: string;
  orgId: string | null;
  kind: "human" | "agent";
  caller: ActionCaller | "unknown";
  /** For the authorship log: the person's email, or "agent". */
  actorId: string;
}

const HUMAN_CALLERS: ReadonlySet<string> = new Set(["frontend", "cli"]);

export class ForbiddenError extends Error {
  override readonly name = "ForbiddenError";
  /** Shown to the person as-is (a 4xx), not as a generic server error. */
  readonly statusCode = 403;
}

export function identity(ctx: ActionRunContext | undefined): Identity {
  const email = ctx?.userEmail ?? (process.env.NODE_ENV === "production" ? undefined : "local@localhost");
  if (!email) throw new ForbiddenError("Sign in to use Crewcut.");
  const caller = ctx?.caller ?? "unknown";
  const kind = HUMAN_CALLERS.has(caller) ? "human" : "agent";
  return { email, orgId: ctx?.orgId ?? null, kind, caller, actorId: kind === "human" ? email : "agent" };
}

/** Throws unless a person made this call. Content the agent reads can never unlock it. */
export function requireHuman(ctx: ActionRunContext | undefined, what: string): Identity {
  const who = identity(ctx);
  if (who.kind !== "human") {
    throw new ForbiddenError(`${what} needs a person. Ask the user to click it in Crewcut.`);
  }
  return who;
}

/**
 * Money decisions for a shared workspace (paying, changing or cancelling its
 * plan) belong to its owner and admins, not to every member. A person's own
 * space (no organisation) is theirs. When the role can't be read, the answer
 * is no.
 */
export async function requireWorkspaceManager(who: Identity, what: string): Promise<void> {
  if (!who.orgId) return;
  let role: string | undefined;
  try {
    const result = (await getDb().execute(sql`select role from org_members where org_id = ${who.orgId} and lower(email) = ${who.email.toLowerCase()} limit 1`)) as unknown;
    const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{ role?: unknown }>;
    role = typeof rows[0]?.role === "string" ? rows[0].role : undefined;
  } catch (error) {
    console.error("[identity] could not read the workspace role:", error instanceof Error ? error.message : error);
  }
  if (role !== "owner" && role !== "admin") {
    throw new ForbiddenError(`${what} is for this workspace's owner and admins. Ask one of them to do it.`);
  }
}

export function accessContext(who: Identity): { userEmail: string; orgId?: string } {
  return { userEmail: who.email, ...(who.orgId ? { orgId: who.orgId } : {}) };
}
