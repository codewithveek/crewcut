import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { billingReady } from "../server/lib/billing/bachs.js";
import { workspaceOf } from "../server/lib/catalog.js";
import { ensureBalance, recentLedger } from "../server/lib/credits.js";
import { identity } from "../server/lib/identity.js";
import { MILLI, PLANS, TOP_UPS, yearlyMonthly } from "../server/lib/plans.js";

export default defineAction({
  description:
    "The person's workspace plan and AI credits: this month's credits and top-ups left, when they refill, what used them this month (by pipeline stage), recent credit history, the subscription, and the plans and top-ups on offer. Crewcut AI and voice-overs on Crewcut's accounts use credits; people's own AI keys don't.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_input, ctx) => {
    const who = identity(ctx);
    const workspace = workspaceOf(who);
    const balance = await ensureBalance(workspace);
    const db = getDb();
    const [byStage, ledger, subscription] = await Promise.all([
      db
        .select({ stage: schema.aiUsage.stage, kind: schema.aiUsage.kind, millicredits: sql<number>`coalesce(sum(${schema.aiUsage.millicredits}), 0)`, calls: sql<number>`count(*)` })
        .from(schema.aiUsage)
        .where(and(eq(schema.aiUsage.workspace, workspace), eq(schema.aiUsage.source, "managed"), gte(schema.aiUsage.createdAt, balance.periodStart)))
        .groupBy(schema.aiUsage.stage, schema.aiUsage.kind),
      recentLedger(workspace, 20),
      db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.workspace, workspace)).orderBy(desc(schema.billingSubscriptions.updatedAt)).limit(1),
    ]);
    const sub = subscription[0];
    // What one AI draft has cost this workspace so far (the average per video), so people can see it before they start.
    const [typical] = await db
      .select({ millicredits: sql<number>`coalesce(avg(total), 0)`, videos: sql<number>`count(*)` })
      .from(
        db
          .select({ total: sql<number>`sum(${schema.aiUsage.millicredits})`.as("total") })
          .from(schema.aiUsage)
          .where(and(eq(schema.aiUsage.workspace, workspace), eq(schema.aiUsage.source, "managed"), sql`${schema.aiUsage.videoId} is not null`))
          .groupBy(schema.aiUsage.videoId)
          .as("per_video"),
      );
    const credits = (milli: number) => Math.round((milli / MILLI) * 10) / 10;
    return {
      workspace,
      balance,
      /** Credits a draft usually takes here; a general figure until this workspace has made a few. */
      typicalDraftCredits: Number(typical?.videos ?? 0) >= 2 ? Math.max(1, Math.round(Number(typical?.millicredits ?? 0) / MILLI)) : 40,
      usedThisPeriod: byStage.map((row) => ({ stage: row.kind === "voice" ? "voice" : row.stage, credits: credits(Number(row.millicredits)), calls: Number(row.calls) })),
      ledger: ledger.map((row) => ({ id: row.id, at: row.createdAt, kind: row.kind, credits: credits(row.millicredits), note: row.note })),
      subscription: sub ? { plan: sub.plan, interval: sub.billingInterval, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd } : null,
      billingReady: billingReady(),
      plans: Object.values(PLANS).map((plan) => ({ ...plan, yearlyMonthly: yearlyMonthly(plan) })),
      topUps: TOP_UPS,
    };
  },
});
