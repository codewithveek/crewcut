import { desc, eq, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { nowIso } from "./json.js";
import { MILLI, type PlanId, normalizePlan, PLANS } from "./plans.js";
import { newId } from "./storage.js";

/**
 * Credits per workspace. Each monthly period grants the plan's credits (no
 * rollover); bought top-ups sit in their own pool for 12 months. Spending
 * takes from the month's grant first. Every change is written to the ledger.
 *
 * Balances are only touched by single SQL statements, so two calls finishing
 * at once can't lose a charge. A call that ends with a bigger bill than the
 * balance may take it slightly below zero; the next call is then refused.
 */

export type Workspace = string;

export interface CreditBalance {
  workspace: Workspace;
  plan: PlanId;
  periodStart: string;
  periodEnd: string;
  /** Whole credits, rounded down for display. */
  monthly: number;
  topup: number;
  available: number;
  /** The plan's monthly grant. */
  allowance: number;
  topupExpiresAt: string | null;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function addMonths(iso: string, months: number): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

export async function planIdOf(workspace: Workspace): Promise<PlanId> {
  const [row] = await getDb().select({ plan: schema.workspacePlans.plan }).from(schema.workspacePlans).where(eq(schema.workspacePlans.workspace, workspace)).limit(1);
  return normalizePlan(row?.plan);
}

async function ledger(entry: { workspace: Workspace; kind: string; pool: "monthly" | "topup"; millicredits: number; ref?: string; note?: string; createdBy?: string }): Promise<boolean> {
  if (entry.millicredits === 0) return true;
  const inserted = await getDb()
    .insert(schema.creditLedger)
    .values({ id: newId("cr"), workspace: entry.workspace, kind: entry.kind, pool: entry.pool, millicredits: Math.round(entry.millicredits), ref: entry.ref ?? "", note: entry.note ?? "", createdBy: entry.createdBy ?? "", createdAt: nowIso() })
    .onConflictDoNothing()
    .returning({ id: schema.creditLedger.id });
  return inserted.length > 0;
}

function toBalance(row: typeof schema.creditBalances.$inferSelect): CreditBalance {
  const plan = normalizePlan(row.plan);
  const topupLive = !row.topupExpiresAt || Date.parse(row.topupExpiresAt) > Date.now();
  const monthly = Math.floor(row.monthlyMillicredits / MILLI);
  const topup = topupLive ? Math.floor(row.topupMillicredits / MILLI) : 0;
  return {
    workspace: row.workspace,
    plan,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    monthly,
    topup,
    available: Math.floor((row.monthlyMillicredits + (topupLive ? row.topupMillicredits : 0)) / MILLI),
    allowance: PLANS[plan].monthlyCredits,
    topupExpiresAt: row.topupExpiresAt,
  };
}

/**
 * The workspace's balance, after starting a new monthly period if one is
 * due, expiring old top-ups, and following plan changes (an upgrade adds the
 * difference now; a downgrade caps this month's credits at the new grant).
 */
export async function ensureBalance(workspace: Workspace): Promise<CreditBalance> {
  const db = getDb();
  const plan = await planIdOf(workspace);
  const allowance = PLANS[plan].monthlyCredits * MILLI;
  const now = nowIso();
  let [row] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.workspace, workspace)).limit(1);

  if (!row) {
    const periodEnd = addMonths(now, 1);
    const created = await db
      .insert(schema.creditBalances)
      .values({ workspace, plan, periodStart: now, periodEnd, monthlyMillicredits: allowance, topupMillicredits: 0, updatedAt: now })
      .onConflictDoNothing()
      .returning();
    if (created[0]) {
      await ledger({ workspace, kind: "grant", pool: "monthly", millicredits: allowance, ref: `grant:${workspace}:${now.slice(0, 10)}:${plan}`, note: `${PLANS[plan].name} monthly credits` });
      return toBalance(created[0]);
    }
    [row] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.workspace, workspace)).limit(1);
    if (!row) throw new Error("Could not read the credit balance.");
  }

  // A new monthly period: the old month's credits don't roll over.
  if (Date.parse(row.periodEnd) <= Date.now()) {
    let periodStart = row.periodEnd;
    let periodEnd = addMonths(periodStart, 1);
    while (Date.parse(periodEnd) <= Date.now()) {
      periodStart = periodEnd;
      periodEnd = addMonths(periodStart, 1);
    }
    const updated = await db
      .update(schema.creditBalances)
      .set({ plan, periodStart, periodEnd, monthlyMillicredits: allowance, updatedAt: now })
      .where(sql`${schema.creditBalances.workspace} = ${workspace} and ${schema.creditBalances.periodEnd} = ${row.periodEnd}`)
      .returning();
    if (updated[0]) {
      const leftover = row.monthlyMillicredits;
      if (leftover > 0) await ledger({ workspace, kind: "expire", pool: "monthly", millicredits: -leftover, ref: `expire:${workspace}:${row.periodEnd}`, note: "Unused monthly credits" });
      await ledger({ workspace, kind: "grant", pool: "monthly", millicredits: allowance, ref: `grant:${workspace}:${periodStart}:${plan}`, note: `${PLANS[plan].name} monthly credits` });
    }
    [row] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.workspace, workspace)).limit(1);
    if (!row) throw new Error("Could not read the credit balance.");
  }

  // Top-ups past their 12 months.
  if (row.topupExpiresAt && Date.parse(row.topupExpiresAt) <= Date.now() && row.topupMillicredits > 0) {
    const expired = await db
      .update(schema.creditBalances)
      .set({ topupMillicredits: 0, updatedAt: now })
      .where(sql`${schema.creditBalances.workspace} = ${workspace} and ${schema.creditBalances.topupMillicredits} > 0 and ${schema.creditBalances.topupExpiresAt} = ${row.topupExpiresAt}`)
      .returning();
    if (expired[0]) await ledger({ workspace, kind: "expire", pool: "topup", millicredits: -row.topupMillicredits, ref: `expire-topup:${workspace}:${row.topupExpiresAt}`, note: "Top-up credits older than 12 months" });
    [row] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.workspace, workspace)).limit(1);
    if (!row) throw new Error("Could not read the credit balance.");
  }

  // The plan changed during the period.
  if (normalizePlan(row.plan) !== plan) {
    const oldAllowance = PLANS[normalizePlan(row.plan)].monthlyCredits * MILLI;
    const delta = allowance > oldAllowance ? allowance - oldAllowance : Math.min(0, allowance - row.monthlyMillicredits);
    const updated = await db
      .update(schema.creditBalances)
      .set({ plan, monthlyMillicredits: sql`${schema.creditBalances.monthlyMillicredits} + ${delta}`, updatedAt: now })
      .where(sql`${schema.creditBalances.workspace} = ${workspace} and ${schema.creditBalances.plan} = ${row.plan}`)
      .returning();
    if (updated[0] && delta !== 0) await ledger({ workspace, kind: "adjust", pool: "monthly", millicredits: delta, ref: `plan:${workspace}:${row.periodStart}:${row.plan}->${plan}`, note: `Plan changed to ${PLANS[plan].name}` });
    [row] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.workspace, workspace)).limit(1);
    if (!row) throw new Error("Could not read the credit balance.");
  }

  return toBalance(row);
}

/** Take credits for one call: this month's credits first, then top-ups. */
export async function spendCredits(workspace: Workspace, millicredits: number, ref: string, note: string): Promise<void> {
  const amount = Math.max(0, Math.round(millicredits));
  if (amount === 0) return;
  const fromMonthly = sql`least(greatest(${schema.creditBalances.monthlyMillicredits}, 0), ${amount})`;
  await getDb()
    .update(schema.creditBalances)
    .set({
      monthlyMillicredits: sql`${schema.creditBalances.monthlyMillicredits} - ${fromMonthly}`,
      topupMillicredits: sql`${schema.creditBalances.topupMillicredits} - (${amount} - ${fromMonthly})`,
      updatedAt: nowIso(),
    })
    .where(eq(schema.creditBalances.workspace, workspace));
  await ledger({ workspace, kind: "usage", pool: "monthly", millicredits: -amount, ref, note });
}

/** Add bought credits (once per payment: `ref` is the payment id). They last 12 months from the latest purchase. */
export async function addTopUp(workspace: Workspace, credits: number, ref: string, note: string, createdBy = "billing"): Promise<boolean> {
  await ensureBalance(workspace);
  const amount = Math.round(credits * MILLI);
  const fresh = await ledger({ workspace, kind: "topup", pool: "topup", millicredits: amount, ref, note, createdBy });
  if (!fresh) return false;
  await getDb()
    .update(schema.creditBalances)
    .set({ topupMillicredits: sql`${schema.creditBalances.topupMillicredits} + ${amount}`, topupExpiresAt: new Date(Date.now() + YEAR_MS).toISOString(), updatedAt: nowIso() })
    .where(eq(schema.creditBalances.workspace, workspace));
  return true;
}

/**
 * Admins: give or take credits. Given credits go to the top-up pool (so they
 * aren't lost at the month's end); taken credits come out like spending,
 * this month's first.
 */
export async function adjustCredits(workspace: Workspace, credits: number, note: string, createdBy: string): Promise<CreditBalance> {
  await ensureBalance(workspace);
  const amount = Math.round(credits * MILLI);
  if (amount < 0) {
    const take = -amount;
    const fromMonthly = sql`least(greatest(${schema.creditBalances.monthlyMillicredits}, 0), ${take})`;
    await getDb()
      .update(schema.creditBalances)
      .set({ monthlyMillicredits: sql`${schema.creditBalances.monthlyMillicredits} - ${fromMonthly}`, topupMillicredits: sql`${schema.creditBalances.topupMillicredits} - (${take} - ${fromMonthly})`, updatedAt: nowIso() })
      .where(eq(schema.creditBalances.workspace, workspace));
    await ledger({ workspace, kind: "adjust", pool: "monthly", millicredits: amount, ref: newId("adj"), note, createdBy });
    return ensureBalance(workspace);
  }
  await ledger({ workspace, kind: "adjust", pool: "topup", millicredits: amount, ref: newId("adj"), note, createdBy });
  await getDb()
    .update(schema.creditBalances)
    .set({
      topupMillicredits: sql`${schema.creditBalances.topupMillicredits} + ${amount}`,
      ...(amount > 0 ? { topupExpiresAt: new Date(Date.now() + YEAR_MS).toISOString() } : {}),
      updatedAt: nowIso(),
    })
    .where(eq(schema.creditBalances.workspace, workspace));
  return ensureBalance(workspace);
}

export async function recentLedger(workspace: Workspace, limit = 30) {
  return getDb().select().from(schema.creditLedger).where(eq(schema.creditLedger.workspace, workspace)).orderBy(desc(schema.creditLedger.createdAt)).limit(limit);
}

export class OutOfCreditsError extends Error {
  override readonly name = "OutOfCreditsError";
  readonly statusCode = 402;
}

/** Throws when the workspace has nothing left to spend. */
export async function assertCredits(workspace: Workspace, what: string): Promise<CreditBalance> {
  const balance = await ensureBalance(workspace);
  if (balance.available <= 0) {
    throw new OutOfCreditsError(
      `You're out of AI credits for ${what}. They refill on ${new Date(balance.periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}. Upgrade or buy a top-up on the Plan page, or add your own AI key under Connect, to keep going.`,
    );
  }
  return balance;
}
