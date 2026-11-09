import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "../../db/index.js";
import { creditSettings, MILLI, PLANS } from "../plans.js";
import { voiceCostMicros, voiceOperatorKey } from "../voice-billing.js";
import { gatewayConfig } from "./gateway.js";
import { allModels, defaultModel, enabledProviders, operatorKey, PROVIDER_ROUTES } from "./models.js";

/**
 * The admin cost page ("Step 0"): what Crewcut AI and voice-overs actually
 * cost, per model, per pipeline stage and per video, so credit prices can be
 * set from measured runs instead of estimates.
 */

const num = (value: unknown) => Number(value ?? 0) || 0;
const dollars = (micros: number) => Math.round(micros) / 1_000_000;

export async function aiCostReport(days: number) {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const usage = schema.aiUsage;
  const inWindow = gte(usage.createdAt, since);

  const aggregates = {
    calls: sql<number>`count(*)`,
    inputTokens: sql<number>`coalesce(sum(${usage.inputTokens}), 0)`,
    outputTokens: sql<number>`coalesce(sum(${usage.outputTokens}), 0)`,
    cacheReadTokens: sql<number>`coalesce(sum(${usage.cacheReadTokens}), 0)`,
    units: sql<number>`coalesce(sum(${usage.units}), 0)`,
    costMicros: sql<number>`coalesce(sum(${usage.costMicros}), 0)`,
    millicredits: sql<number>`coalesce(sum(${usage.millicredits}), 0)`,
    errors: sql<number>`count(${usage.error})`,
  };

  const [bySource, byModel, byStage, videoRows, recent] = await Promise.all([
    db.select({ source: usage.source, kind: usage.kind, ...aggregates }).from(usage).where(inWindow).groupBy(usage.source, usage.kind),
    db.select({ source: usage.source, provider: usage.provider, model: usage.model, kind: usage.kind, ...aggregates }).from(usage).where(inWindow).groupBy(usage.source, usage.provider, usage.model, usage.kind).orderBy(desc(sql`sum(${usage.costMicros})`)),
    db.select({ stage: usage.stage, ...aggregates, videos: sql<number>`count(distinct ${usage.videoId})` }).from(usage).where(inWindow).groupBy(usage.stage).orderBy(desc(sql`sum(${usage.costMicros})`)),
    db
      .select({ videoId: usage.videoId, ...aggregates, voiceCost: sql<number>`coalesce(sum(case when ${usage.kind} = 'voice' then ${usage.costMicros} else 0 end), 0)`, first: sql<string>`min(${usage.createdAt})`, last: sql<string>`max(${usage.createdAt})` })
      .from(usage)
      .where(and(inWindow, sql`${usage.videoId} is not null`))
      .groupBy(usage.videoId)
      .orderBy(desc(sql`max(${usage.createdAt})`))
      .limit(60),
    db.select().from(usage).where(inWindow).orderBy(desc(usage.createdAt)).limit(40),
  ]);

  const videoIds = videoRows.map((row) => row.videoId).filter((id): id is string => Boolean(id));
  const [titles, stageSplits, renders] = videoIds.length
    ? await Promise.all([
        db.select({ id: schema.videos.id, title: schema.videos.title, autopilot: schema.videos.autopilot }).from(schema.videos).where(inArray(schema.videos.id, videoIds)),
        db.select({ videoId: usage.videoId, stage: usage.stage, costMicros: sql<number>`coalesce(sum(${usage.costMicros}), 0)` }).from(usage).where(and(inWindow, inArray(usage.videoId, videoIds))).groupBy(usage.videoId, usage.stage),
        db
          .select({
            videoId: schema.renderJobs.videoId,
            jobs: sql<number>`count(*)`,
            seconds: sql<number>`coalesce(sum(extract(epoch from ((${schema.renderJobs.updatedAt})::timestamptz - coalesce(${schema.renderJobs.lockedAt}, ${schema.renderJobs.createdAt})::timestamptz))), 0)`,
          })
          .from(schema.renderJobs)
          .where(and(inArray(schema.renderJobs.videoId, videoIds), eq(schema.renderJobs.status, "done")))
          .groupBy(schema.renderJobs.videoId),
      ])
    : [[], [], []];

  const titleById = new Map(titles.map((row) => [row.id, row]));
  const renderById = new Map(renders.map((row) => [row.videoId, row]));
  const videos = videoRows.map((row) => {
    const info = row.videoId ? titleById.get(row.videoId) : undefined;
    const render = row.videoId ? renderById.get(row.videoId) : undefined;
    return {
      videoId: row.videoId,
      title: info?.title ?? "(deleted video)",
      autopilot: Boolean(info?.autopilot?.startsWith('{"on":true')),
      calls: num(row.calls),
      costUsd: dollars(num(row.costMicros)),
      voiceUsd: dollars(num(row.voiceCost)),
      credits: num(row.millicredits) / MILLI,
      renderJobs: num(render?.jobs),
      renderSeconds: Math.round(num(render?.seconds)),
      stages: Object.fromEntries(stageSplits.filter((split) => split.videoId === row.videoId).map((split) => [split.stage, dollars(num(split.costMicros))])),
      first: row.first,
      last: row.last,
    };
  });
  const costs = videos.map((video) => video.costUsd).sort((a, b) => a - b);
  const median = costs.length ? (costs.length % 2 ? costs[(costs.length - 1) / 2]! : (costs[costs.length / 2 - 1]! + costs[costs.length / 2]!) / 2) : 0;

  const gateway = gatewayConfig();
  const providers = enabledProviders();
  const fallback = defaultModel();
  const settings = creditSettings();

  return {
    days,
    since,
    setup: {
      gateway: gateway ? { accountId: `${gateway.accountId.slice(0, 6)}…`, gatewayId: gateway.gatewayId, keyAlias: gateway.keyAlias ?? null } : null,
      providers: Object.entries(PROVIDER_ROUTES).map(([id, route]) => ({ id, label: route.label, enabled: providers.has(id as keyof typeof PROVIDER_ROUTES), keySource: route.keyEnv === null ? "gateway token" : operatorKey(id as keyof typeof PROVIDER_ROUTES) ? "Crewcut key" : "stored in gateway / Unified Billing" })),
      defaultModel: fallback?.id ?? null,
      models: allModels().map((model) => ({ ...model, enabled: providers.has(model.provider) })),
      voice: { crewcutKey: Boolean(voiceOperatorKey()), usdPerThousandChars: voiceCostMicros(1000) / 1_000_000 },
      credits: { ...settings, plans: Object.values(PLANS).map((plan) => ({ id: plan.id, name: plan.name, monthlyCredits: plan.monthlyCredits, maxCostUsd: Math.round(((plan.monthlyCredits * settings.creditUsd) / settings.markup) * 100) / 100 })) },
    },
    totals: bySource.map((row) => ({ source: row.source, kind: row.kind, calls: num(row.calls), inputTokens: num(row.inputTokens), outputTokens: num(row.outputTokens), cacheReadTokens: num(row.cacheReadTokens), characters: num(row.units), costUsd: dollars(num(row.costMicros)), credits: num(row.millicredits) / MILLI, errors: num(row.errors) })),
    byModel: byModel.map((row) => ({ source: row.source, provider: row.provider, model: row.model, kind: row.kind, calls: num(row.calls), inputTokens: num(row.inputTokens), outputTokens: num(row.outputTokens), cacheReadTokens: num(row.cacheReadTokens), characters: num(row.units), costUsd: dollars(num(row.costMicros)), credits: num(row.millicredits) / MILLI, errors: num(row.errors) })),
    byStage: byStage.map((row) => ({ stage: row.stage, calls: num(row.calls), videos: num(row.videos), costUsd: dollars(num(row.costMicros)), avgPerVideoUsd: num(row.videos) ? dollars(num(row.costMicros) / num(row.videos)) : null, credits: num(row.millicredits) / MILLI })),
    perVideo: { count: videos.length, averageUsd: costs.length ? Math.round((costs.reduce((sum, cost) => sum + cost, 0) / costs.length) * 10000) / 10000 : 0, medianUsd: median, maxUsd: costs[costs.length - 1] ?? 0 },
    videos,
    recent: recent.map((row) => ({ id: row.id, at: row.createdAt, source: row.source, kind: row.kind, model: row.model, stage: row.stage, videoId: row.videoId, inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens, characters: row.units, costUsd: dollars(row.costMicros), credits: row.millicredits / MILLI, durationMs: row.durationMs, error: row.error, workspace: row.workspace })),
  };
}
