import { desc, eq, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { nowIso } from "./json.js";
import { MILLI, type PlanId, normalizePlan, PLANS } from "./plans.js";
import { newId } from "./storage.js";

/**
 * Credits per workspace, in two pools: this period's grant from the plan
 * ("monthly", no rollover) and bought credits ("topup", 12 months from the
 * latest purchase). Spending takes from the grant first. Every change is
 * written to the ledger with the pool it touched, so the history shows which
 * credits went where.
 *
 * A paying workspace's period follows its Bachs billing period (renewals
 * reset the grant); everyone else's runs monthly from when their balance was
 * first made.
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

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;
/** A paid period that ends with no renewal webhook yet still refills after this long (webhooks can be late). */
const RENEWAL_GRACE_MS = 3 * DAY_MS;

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

  // A new monthly period: the old month's credits don't roll over. A paid
  // period normally renews from Bachs (syncSubscriptionPeriod); this only
  // steps in when that hasn't arrived well after the period ended.
  const rollAt = Date.parse(row.periodEnd) + (row.periodSource === "subscription" ? RENEWAL_GRACE_MS : 0);
  if (rollAt <= Date.now()) {
    let periodStart = row.periodEnd;
    let periodEnd = addMonths(periodStart, 1);
    while (Date.parse(periodEnd) <= Date.now()) {
      periodStart = periodEnd;
      periodEnd = addMonths(periodStart, 1);
    }
    const updated = await db
      .update(schema.creditBalances)
      .set({ plan, periodStart, periodEnd, periodSource: "calendar", monthlyMillicredits: allowance, updatedAt: now })
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

type Rows = { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
const rowsOf = (result: unknown) => (Array.isArray(result) ? result : ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])) as Array<Record<string, unknown>>;

/**
 * Take `amount` millicredits: this period's grant first, then bought credits.
 * One statement: the CTE locks the row and reads the grant as it was, so the
 * split it reports is exactly what was taken, even with calls racing.
 */
async function takeCredits(workspace: Workspace, amount: number): Promise<{ fromMonthly: number; fromTopup: number }> {
  const result = (await getDb().execute(sql`
    with before as (select monthly_millicredits as m from credit_balances where workspace = ${workspace} for update)
    update credit_balances
       set monthly_millicredits = monthly_millicredits - least(greatest((select m from before), 0), ${amount}),
           topup_millicredits = topup_millicredits - (${amount} - least(greatest((select m from before), 0), ${amount})),
           updated_at = ${nowIso()}
     where workspace = ${workspace}
     returning (select m from before) as before_monthly`)) as Rows;
  const before = Number(rowsOf(result)[0]?.before_monthly ?? 0);
  const fromMonthly = Math.min(Math.max(before, 0), amount);
  return { fromMonthly, fromTopup: amount - fromMonthly };
}

/** Ledger rows for credits taken, one per pool they came from. */
async function ledgerTaken(entry: { workspace: Workspace; kind: string; ref: string; note: string; createdBy?: string }, taken: { fromMonthly: number; fromTopup: number }): Promise<void> {
  if (taken.fromMonthly > 0) await ledger({ ...entry, pool: "monthly", millicredits: -taken.fromMonthly });
  if (taken.fromTopup > 0) await ledger({ ...entry, pool: "topup", millicredits: -taken.fromTopup, ref: `${entry.ref}:topup`, note: `${entry.note} (bought credits)` });
}

/** Take credits for one call: this period's credits first, then bought ones. */
export async function spendCredits(workspace: Workspace, millicredits: number, ref: string, note: string): Promise<void> {
  const amount = Math.max(0, Math.round(millicredits));
  if (amount === 0) return;
  const taken = await takeCredits(workspace, amount);
  await ledgerTaken({ workspace, kind: "usage", ref, note }, taken);
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
    const taken = await takeCredits(workspace, -amount);
    await ledgerTaken({ workspace, kind: "adjust", ref: newId("adj"), note, createdBy }, taken);
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

/**
 * Follow a paid subscription's billing period (from Bachs). The first time,
 * the workspace's period just moves onto the billing dates (the upgrade
 * already added its credits). After that, a later billing period is a
 * renewal: the grant resets to the plan's credits, once, however often the
 * event arrives.
 */
export async function syncSubscriptionPeriod(workspace: Workspace, start: string | undefined, end: string | undefined): Promise<"renewed" | "aligned" | "unchanged"> {
  const startMs = start ? Date.parse(start) : NaN;
  const endMs = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return "unchanged";
  const periodStart = new Date(startMs).toISOString();
  const periodEnd = new Date(endMs).toISOString();
  await ensureBalance(workspace);
  const db = getDb();
  const [row] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.workspace, workspace)).limit(1);
  if (!row) return "unchanged";
  if (row.periodSource === "subscription" && row.periodStart === periodStart && row.periodEnd === periodEnd) return "unchanged";

  const plan = normalizePlan(row.plan);
  const renewal = row.periodSource === "subscription" && startMs >= Date.parse(row.periodStart) + DAY_MS && endMs > Date.parse(row.periodEnd);
  if (renewal) {
    const allowance = PLANS[plan].monthlyCredits * MILLI;
    const updated = await db
      .update(schema.creditBalances)
      .set({ periodStart, periodEnd, monthlyMillicredits: allowance, updatedAt: nowIso() })
      .where(sql`${schema.creditBalances.workspace} = ${workspace} and ${schema.creditBalances.periodStart} = ${row.periodStart}`)
      .returning();
    if (!updated[0]) return "unchanged";
    if (row.monthlyMillicredits > 0) await ledger({ workspace, kind: "expire", pool: "monthly", millicredits: -row.monthlyMillicredits, ref: `expire:${workspace}:${row.periodEnd}`, note: "Unused credits from last period" });
    await ledger({ workspace, kind: "grant", pool: "monthly", millicredits: allowance, ref: `grant:${workspace}:${periodStart}:${plan}`, note: `${PLANS[plan].name} credits for this billing period` });
    return "renewed";
  }
  await db.update(schema.creditBalances).set({ periodStart, periodEnd, periodSource: "subscription", updatedAt: nowIso() }).where(eq(schema.creditBalances.workspace, workspace));
  return "aligned";
}

/** Back on Free: the period keeps its dates but refills monthly on its own again. */
export async function useCalendarPeriod(workspace: Workspace): Promise<void> {
  await getDb().update(schema.creditBalances).set({ periodSource: "calendar", updatedAt: nowIso() }).where(eq(schema.creditBalances.workspace, workspace));
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
