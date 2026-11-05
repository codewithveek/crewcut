import type { ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { type Composition, type StyleFingerprint, parseComposition, styleFingerprint } from "@crewcut/composition";
import {
  type ApprovalEvent,
  type AuditReport,
  DEFAULT_GATE_POLICY,
  type Dossier,
  type GatePolicy,
  type Idea,
  type Platform,
  type QaReport,
  type Script,
  type Stage,
  type StageStates,
  auditReportSchema,
  dossierSchema,
  gatePolicySchema,
  ideaSchema,
  platformSchema,
  qaReportSchema,
  scriptSchema,
  stageStatesSchema,
} from "@crewcut/contracts";
import { type SQL, and, asc, desc, eq, inArray, not, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import { type Identity, accessContext, identity } from "./identity.js";
import { nowIso, parseJson, parseJsonStrict, toJson } from "./json.js";
import { containsText } from "./search.js";
import { newId } from "./storage.js";

export type VideoRow = typeof schema.videos.$inferSelect;
export type ProjectRow = typeof schema.projects.$inferSelect;

export interface VideoRecord {
  row: VideoRow;
  stages: StageStates;
  ideas: Idea[];
  platforms: Platform[];
  who: Identity;
}

export function ownership(who: Identity): { ownerEmail: string; orgId: string | null } {
  return { ownerEmail: who.email, orgId: who.orgId };
}

// ── Videos and projects ────────────────────────────────────────────────────

export async function loadVideo(videoId: string, ctx: ActionRunContext | undefined, role: "viewer" | "editor" = "viewer"): Promise<VideoRecord> {
  const who = identity(ctx);
  await assertAccess("video", videoId, role, accessContext(who), { skipResourceBody: true });
  const [row] = await getDb().select().from(schema.videos).where(eq(schema.videos.id, videoId)).limit(1);
  if (!row) throw new Error(`Video ${videoId} not found`);
  return {
    row,
    stages: parseJson(stageStatesSchema, row.stages, stageStatesSchema.parse({})),
    ideas: parseJson(z.array(ideaSchema), row.ideas, []),
    platforms: parseJson(z.array(platformSchema), row.platforms, ["youtube"]),
    who,
  };
}

export async function listVideos(ctx: ActionRunContext | undefined): Promise<VideoRow[]> {
  const who = identity(ctx);
  return getDb()
    .select()
    .from(schema.videos)
    .where(accessFilter(schema.videos, schema.videoShares, accessContext(who)))
    .orderBy(desc(schema.videos.updatedAt))
    .limit(100);
}

export type VideoFilter = "all" | "pipeline" | "drafts" | "published" | "waiting";
export type VideoSort = "recent" | "created" | "title";
export type VideoCounts = Record<VideoFilter, number>;

const V = schema.videos;
const IS_PUBLISHED = sql`${V.status} in ('published', 'sample')`;
const HAS_BRIEF = sql`trim(${V.brief}) <> ''`;
const IS_WAITING = sql`${V.stages} like '%"awaiting_approval"%'`;
/** Same buckets the projects page shows: agent videos, hand-made drafts, published, and those waiting on the person. */
const VIDEO_FILTERS: Record<Exclude<VideoFilter, "all">, SQL> = {
  published: IS_PUBLISHED,
  pipeline: and(HAS_BRIEF, not(IS_PUBLISHED)) as SQL,
  drafts: and(not(HAS_BRIEF), not(IS_PUBLISHED)) as SQL,
  waiting: and(IS_WAITING, not(IS_PUBLISHED)) as SQL,
};

/** One page of the person's videos with search, filter and sort done in the database, plus counts per filter. */
export async function searchVideos(
  ctx: ActionRunContext | undefined,
  options: { query?: string; filter?: VideoFilter; sort?: VideoSort; limit: number; offset: number },
): Promise<{ rows: VideoRow[]; total: number; counts: VideoCounts }> {
  const who = identity(ctx);
  const db = getDb();
  const text = options.query?.trim();
  const base = and(accessFilter(V, schema.videoShares, accessContext(who)), text ? or(containsText(V.title, text), containsText(V.brief, text)) : undefined);
  const filter = options.filter ?? "all";
  const order = options.sort === "title" ? [asc(sql`lower(${V.title})`), desc(V.updatedAt)] : options.sort === "created" ? [desc(V.createdAt), desc(V.id)] : [desc(V.updatedAt), desc(V.id)];
  const count = (condition: SQL) => sql<number>`coalesce(sum(case when ${condition} then 1 else 0 end), 0)`;
  const [rows, [totals]] = await Promise.all([
    db.select().from(V).where(and(base, filter === "all" ? undefined : VIDEO_FILTERS[filter])).orderBy(...order).limit(options.limit).offset(options.offset),
    db
      .select({
        all: sql<number>`count(*)`,
        published: count(VIDEO_FILTERS.published),
        pipeline: count(VIDEO_FILTERS.pipeline),
        drafts: count(VIDEO_FILTERS.drafts),
        waiting: count(VIDEO_FILTERS.waiting),
      })
      .from(V)
      .where(base),
  ]);
  const counts: VideoCounts = { all: 0, published: 0, pipeline: 0, drafts: 0, waiting: 0 };
  for (const key of Object.keys(counts) as VideoFilter[]) counts[key] = Number(totals?.[key] ?? 0);
  return { rows, total: counts[filter], counts };
}

export async function listProjects(ctx: ActionRunContext | undefined): Promise<ProjectRow[]> {
  const who = identity(ctx);
  return getDb().select().from(schema.projects).where(accessFilter(schema.projects, schema.projectShares, accessContext(who))).orderBy(desc(schema.projects.createdAt));
}

export async function getProject(projectId: string): Promise<ProjectRow | null> {
  const [row] = await getDb().select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  return row ?? null;
}

export function gatePolicyOf(project: ProjectRow | null): GatePolicy {
  return project ? parseJson(gatePolicySchema, project.gatePolicy, DEFAULT_GATE_POLICY) : DEFAULT_GATE_POLICY;
}

/** The person's default project, created on first use. */
export async function ensureDefaultProject(who: Identity): Promise<ProjectRow> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.ownerEmail, who.email), eq(schema.projects.isDemo, false)))
    .orderBy(schema.projects.createdAt)
    .limit(1);
  if (existing) return existing;
  const row = { id: newId("prj"), name: "My channel", niche: "", gatePolicy: toJson(DEFAULT_GATE_POLICY), ...ownership(who) };
  await db.insert(schema.projects).values(row);
  return (await getProject(row.id)) as ProjectRow;
}

export async function updateVideo(videoId: string, patch: Partial<Omit<VideoRow, "id">>): Promise<void> {
  await getDb().update(schema.videos).set({ ...patch, updatedAt: nowIso() }).where(eq(schema.videos.id, videoId));
}

export async function saveStages(videoId: string, stages: StageStates): Promise<void> {
  await updateVideo(videoId, { stages: toJson(stages) });
}

// ── Approvals (the authorship log) ─────────────────────────────────────────

export async function recordApproval(
  video: VideoRecord,
  event: { stage: Stage; decision: ApprovalEvent["decision"]; reason?: string; subject?: string; actor?: Identity },
): Promise<void> {
  const actor = event.actor ?? video.who;
  await getDb().insert(schema.approvalEvents).values({
    id: newId("apv"),
    videoId: video.row.id,
    stage: event.stage,
    actorKind: actor.kind,
    actor: actor.actorId,
    decision: event.decision,
    reason: event.reason ?? null,
    subject: event.subject ?? null,
    ownerEmail: video.row.ownerEmail,
    orgId: video.row.orgId,
  });
}

export async function listApprovals(videoId: string): Promise<ApprovalEvent[]> {
  const rows = await getDb().select().from(schema.approvalEvents).where(eq(schema.approvalEvents.videoId, videoId)).orderBy(schema.approvalEvents.createdAt);
  return rows.map((row) => ({
    id: row.id,
    videoId: row.videoId,
    stage: row.stage as Stage,
    actorKind: row.actorKind as ApprovalEvent["actorKind"],
    actor: row.actor,
    decision: row.decision as ApprovalEvent["decision"],
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.subject ? { subject: row.subject } : {}),
    createdAt: row.createdAt,
  }));
}

// ── Dossier and sources ────────────────────────────────────────────────────

export async function loadDossier(videoId: string): Promise<Dossier | null> {
  const [row] = await getDb().select().from(schema.dossiers).where(eq(schema.dossiers.videoId, videoId)).limit(1);
  return row ? parseJsonStrict(dossierSchema, row.body, "dossier") : null;
}

export async function saveDossier(video: VideoRecord, dossier: Dossier): Promise<void> {
  const db = getDb();
  const body = toJson(dossier);
  const existing = await loadDossier(video.row.id);
  if (existing) await db.update(schema.dossiers).set({ body, updatedAt: nowIso() }).where(eq(schema.dossiers.videoId, video.row.id));
  else await db.insert(schema.dossiers).values({ videoId: video.row.id, body, ownerEmail: video.row.ownerEmail, orgId: video.row.orgId });
}

export async function listSources(videoId: string) {
  return getDb().select().from(schema.sources).where(eq(schema.sources.videoId, videoId)).orderBy(schema.sources.retrievedAt);
}

// ── Script, audit, QA ──────────────────────────────────────────────────────

export async function latestScript(videoId: string): Promise<{ version: number; script: Script; authorKind: string; author: string } | null> {
  const [row] = await getDb().select().from(schema.scripts).where(eq(schema.scripts.videoId, videoId)).orderBy(desc(schema.scripts.version)).limit(1);
  return row ? { version: row.version, script: parseJsonStrict(scriptSchema, row.body, "script"), authorKind: row.authorKind, author: row.author } : null;
}

export async function saveScript(video: VideoRecord, script: Script, note: string, actor: Identity = video.who): Promise<number> {
  const current = await latestScript(video.row.id);
  const version = (current?.version ?? 0) + 1;
  await getDb().insert(schema.scripts).values({
    id: newId("scr"),
    videoId: video.row.id,
    version,
    body: toJson(script),
    authorKind: actor.kind,
    author: actor.actorId,
    note,
    ownerEmail: video.row.ownerEmail,
    orgId: video.row.orgId,
  });
  await updateVideo(video.row.id, { scriptVersion: version, ...(version === 1 ? { title: script.headline } : {}) });
  return version;
}

export async function latestAudit(videoId: string): Promise<AuditReport | null> {
  const [row] = await getDb().select().from(schema.claimAudits).where(eq(schema.claimAudits.videoId, videoId)).orderBy(desc(schema.claimAudits.createdAt)).limit(1);
  return row ? parseJsonStrict(auditReportSchema, row.report, "claim audit") : null;
}

export async function saveAudit(video: VideoRecord, report: AuditReport): Promise<void> {
  await getDb().insert(schema.claimAudits).values({
    id: newId("aud"),
    videoId: video.row.id,
    scriptVersion: report.scriptVersion,
    report: toJson(report),
    ownerEmail: video.row.ownerEmail,
    orgId: video.row.orgId,
  });
}

export async function latestQa(videoId: string): Promise<QaReport | null> {
  const [row] = await getDb().select().from(schema.qaReports).where(eq(schema.qaReports.videoId, videoId)).orderBy(desc(schema.qaReports.createdAt)).limit(1);
  return row ? parseJsonStrict(qaReportSchema, row.report, "QA report") : null;
}

export async function saveQa(video: VideoRecord, report: QaReport, versions: { script: number; composition: number }): Promise<void> {
  await getDb().insert(schema.qaReports).values({
    id: newId("qa"),
    videoId: video.row.id,
    scriptVersion: versions.script,
    compositionVersion: versions.composition,
    report: toJson(report),
    ownerEmail: video.row.ownerEmail,
    orgId: video.row.orgId,
  });
}

// ── Compositions (versioned: every edit is one undoable step) ──────────────

export async function latestComposition(videoId: string): Promise<{ version: number; composition: Composition; label: string } | null> {
  const [row] = await getDb().select().from(schema.compositions).where(eq(schema.compositions.videoId, videoId)).orderBy(desc(schema.compositions.version)).limit(1);
  return row ? { version: row.version, composition: parseComposition(JSON.parse(row.body)), label: row.label } : null;
}

export async function compositionAt(videoId: string, version: number): Promise<Composition | null> {
  const [row] = await getDb()
    .select()
    .from(schema.compositions)
    .where(and(eq(schema.compositions.videoId, videoId), eq(schema.compositions.version, version)))
    .limit(1);
  return row ? parseComposition(JSON.parse(row.body)) : null;
}

export async function saveComposition(video: VideoRecord, composition: Composition, label: string, actor: Identity = video.who): Promise<number> {
  const validated = parseComposition(composition);
  const current = await getDb()
    .select({ version: schema.compositions.version })
    .from(schema.compositions)
    .where(eq(schema.compositions.videoId, video.row.id))
    .orderBy(desc(schema.compositions.version))
    .limit(1);
  const version = (current[0]?.version ?? 0) + 1;
  await getDb().insert(schema.compositions).values({
    id: newId("cmp"),
    videoId: video.row.id,
    version,
    body: toJson(validated),
    fingerprint: toJson(styleFingerprint(validated)),
    label: actor.kind === "agent" ? `Agent: ${label}` : label,
    authorKind: actor.kind,
    author: actor.actorId,
    ownerEmail: video.row.ownerEmail,
    orgId: video.row.orgId,
  });
  await updateVideo(video.row.id, { compositionVersion: version });
  return version;
}

export async function listCompositionVersions(videoId: string, limit = 50, offset = 0) {
  return getDb()
    .select({
      version: schema.compositions.version,
      label: schema.compositions.label,
      authorKind: schema.compositions.authorKind,
      author: schema.compositions.author,
      createdAt: schema.compositions.createdAt,
    })
    .from(schema.compositions)
    .where(eq(schema.compositions.videoId, videoId))
    .orderBy(desc(schema.compositions.version))
    .limit(limit)
    .offset(offset);
}

/** Fingerprints of the workspace's other recent videos, for the variety guard. */
export async function recentFingerprints(projectId: string, excludeVideoId: string): Promise<Array<{ id: string; title: string; fingerprint: StyleFingerprint }>> {
  const db = getDb();
  const videos = await db
    .select({ id: schema.videos.id, title: schema.videos.title, version: schema.videos.compositionVersion })
    .from(schema.videos)
    .where(eq(schema.videos.projectId, projectId))
    .orderBy(desc(schema.videos.updatedAt))
    .limit(11);
  const others = videos.filter((video) => video.id !== excludeVideoId && video.version > 0).slice(0, 10);
  if (others.length === 0) return [];
  const rows = await db
    .select({ videoId: schema.compositions.videoId, version: schema.compositions.version, fingerprint: schema.compositions.fingerprint })
    .from(schema.compositions)
    .where(inArray(schema.compositions.videoId, others.map((video) => video.id)));
  return others.flatMap((video) => {
    const row = rows.find((candidate) => candidate.videoId === video.id && candidate.version === video.version);
    return row ? [{ id: video.id, title: video.title, fingerprint: JSON.parse(row.fingerprint) as StyleFingerprint }] : [];
  });
}
