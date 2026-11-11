import type { ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess, resolveAccess, roleSatisfies } from "@agent-native/core/sharing";
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
import { type Identity, ForbiddenError, accessContext, identity } from "./identity.js";
import { nowIso, parseJson, parseJsonStrict, toJson } from "./json.js";
import { containsText } from "./search.js";
import { newId } from "./storage.js";
import { UserError } from "./errors.js";

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
  // The access check already reads the whole row: use it instead of a second round trip.
  const access = await assertAccess("video", videoId, role, accessContext(who));
  const loaded = access.resource as Partial<VideoRow> | undefined;
  const row =
    loaded && typeof loaded.id === "string" && typeof loaded.stages === "string"
      ? (loaded as VideoRow)
      : (await getDb().select().from(schema.videos).where(eq(schema.videos.id, videoId)).limit(1))[0];
  if (!row) throw new Error(`Video ${videoId} not found`);
  const sameWorkspace = Boolean(who.orgId && row.orgId === who.orgId);
  if (row.visibility === "public" && row.ownerEmail.toLowerCase() !== who.email.toLowerCase() && !sameWorkspace) await assertNotOnlyPublic(videoId, who);
  return {
    row,
    stages: parseJson(stageStatesSchema, row.stages, stageStatesSchema.parse({})),
    ideas: parseJson(z.array(ideaSchema), row.ideas, []),
    platforms: parseJson(z.array(platformSchema), row.platforms, ["youtube"]),
    who,
  };
}

/** Things only the video's owner may do (publish to their channel, delete the video), whatever an editor share allows. */
export function requireOwner(video: VideoRecord, what: string): void {
  if (video.row.ownerEmail.toLowerCase() !== video.who.email.toLowerCase()) {
    throw new ForbiddenError(`${what} is only for the video's owner. Ask them to do it.`);
  }
}

/**
 * "Anyone with the link" means anyone may WATCH the finished export (/watch).
 * The framework would also make every signed-in person a viewer of the whole
 * project (brief, script, sources, edit, approvals with emails), so a public
 * video opens in the app only for people it was actually shared with.
 */
async function assertNotOnlyPublic(videoId: string, who: Identity): Promise<void> {
  if (!(await isInvited(schema.videoShares, videoId, who))) throw new ForbiddenError(`No access to video ${videoId}`);
}

/** True when the resource was shared with this person, or with their workspace. */
async function isInvited(shares: typeof schema.videoShares | typeof schema.projectShares, resourceId: string, who: Identity): Promise<boolean> {
  const principals = or(
    and(eq(shares.principalType, "user"), sql`lower(${shares.principalId}) = ${who.email.toLowerCase()}`),
    ...(who.orgId ? [and(eq(shares.principalType, "org"), eq(shares.principalId, who.orgId))] : []),
  );
  const [share] = await getDb().select({ id: shares.id }).from(shares).where(and(eq(shares.resourceId, resourceId), principals)).limit(1);
  return Boolean(share);
}

/** The owner, someone in the same workspace, or someone it was shared with: the people who may know a resource exists. */
async function isMember(row: { ownerEmail: string; orgId: string | null }, shares: typeof schema.videoShares | typeof schema.projectShares, resourceId: string, who: Identity): Promise<boolean> {
  if (row.ownerEmail.toLowerCase() === who.email.toLowerCase()) return true;
  if (who.orgId && row.orgId === who.orgId) return true;
  return isInvited(shares, resourceId, who);
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

/** A project the caller may add to (videos, learnings): never trust a project id from the request on its own. */
/**
 * A project the caller may add to (videos, learnings): never trust a project
 * id from the request on its own. Someone who wasn't invited and isn't in the
 * project's workspace gets the same 404 as for a project that doesn't exist,
 * so an id never reveals that a project is there. Members without the role
 * (e.g. viewers) are told they need edit access.
 */
export async function requireProjectAccess(projectId: string, ctx: ActionRunContext | undefined, role: "viewer" | "editor" = "editor"): Promise<ProjectRow> {
  const who = identity(ctx);
  const access = await resolveAccess("project", projectId, accessContext(who));
  const loaded = access?.resource as Partial<ProjectRow> | undefined;
  const row = !access ? null : loaded && typeof loaded.id === "string" && typeof loaded.gatePolicy === "string" ? (loaded as ProjectRow) : await getProject(projectId);
  // Public visibility alone doesn't count: only owners, the workspace and invited people.
  if (!access || !row || !(await isMember(row, schema.projectShares, projectId, who))) throw new UserError("Project not found.", 404);
  if (!roleSatisfies(access.role, role)) throw new ForbiddenError(`You need ${role} access to this project. Ask its owner to invite you as an ${role}.`);
  return row;
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
  const body = toJson(dossier);
  await getDb()
    .insert(schema.dossiers)
    .values({ videoId: video.row.id, body, ownerEmail: video.row.ownerEmail, orgId: video.row.orgId })
    .onConflictDoUpdate({ target: schema.dossiers.videoId, set: { body, updatedAt: nowIso() } });
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

/**
 * Latest compositions of many videos in one query, using each video's
 * recorded composition version (falls back per video if that row is missing).
 */
export async function latestCompositions(videos: ReadonlyArray<{ id: string; compositionVersion: number }>): Promise<Map<string, Composition>> {
  const wanted = videos.filter((video) => video.compositionVersion > 0);
  const result = new Map<string, Composition>();
  if (wanted.length === 0) return result;
  const C = schema.compositions;
  const rows = await getDb()
    .select({ videoId: C.videoId, body: C.body })
    .from(C)
    .where(or(...wanted.map((video) => and(eq(C.videoId, video.id), eq(C.version, video.compositionVersion)))));
  for (const row of rows) {
    try {
      result.set(row.videoId, parseComposition(JSON.parse(row.body)));
    } catch {
      // A composition that no longer parses shows as a card without a preview.
    }
  }
  const missing = wanted.filter((video) => !rows.some((row) => row.videoId === video.id));
  await Promise.all(
    missing.map(async (video) => {
      const entry = await latestComposition(video.id).catch(() => null);
      if (entry) result.set(video.id, entry.composition);
    }),
  );
  return result;
}

export async function compositionAt(videoId: string, version: number): Promise<Composition | null> {
  const [row] = await getDb()
    .select()
    .from(schema.compositions)
    .where(and(eq(schema.compositions.videoId, videoId), eq(schema.compositions.version, version)))
    .limit(1);
  return row ? parseComposition(JSON.parse(row.body)) : null;
}

/** True for the database's "this version already exists" refusal (the unique index on video + version). */
export function isVersionConflict(error: unknown): boolean {
  for (let cause: unknown = error, depth = 0; cause && depth < 5; depth += 1) {
    const info = cause as { code?: unknown; message?: unknown; cause?: unknown };
    if (info.code === "23505" || (typeof info.message === "string" && /compositions_video_version_unique|duplicate key value/i.test(info.message))) return true;
    cause = info.cause;
  }
  return false;
}

/**
 * Saves a composition as the video's next version. Versions are unique per
 * video, so when someone else saved at the same moment the number is taken:
 * by default this takes the next one (right for writes that replace the whole
 * video: a restore, a fresh compose). An edit worked out from the previous
 * version passes `onConflict: "fail"` and applies itself again on top of the
 * other save instead (see editComposition), so neither is lost.
 */
export async function saveComposition(video: VideoRecord, composition: Composition, label: string, actor: Identity = video.who, options: { onConflict?: "next" | "fail" } = {}): Promise<number> {
  const validated = parseComposition(composition);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await insertComposition(video, validated, label, actor);
    } catch (error) {
      if (options.onConflict === "fail" || attempt >= 4 || !isVersionConflict(error)) throw error;
    }
  }
}

async function insertComposition(video: VideoRecord, validated: Composition, label: string, actor: Identity): Promise<number> {
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
  // Never backwards: of two saves finishing close together, the later version must win whichever write lands last.
  await getDb()
    .update(schema.videos)
    .set({ compositionVersion: sql`greatest(${schema.videos.compositionVersion}, ${version})`, updatedAt: nowIso() })
    .where(eq(schema.videos.id, video.row.id));
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
  // Only each video's current version, not every version it ever had.
  const C = schema.compositions;
  const rows = await db
    .select({ videoId: C.videoId, version: C.version, fingerprint: C.fingerprint })
    .from(C)
    .where(or(...others.map((video) => and(eq(C.videoId, video.id), eq(C.version, video.version)))));
  return others.flatMap((video) => {
    const row = rows.find((candidate) => candidate.videoId === video.id && candidate.version === video.version);
    return row ? [{ id: video.id, title: video.title, fingerprint: JSON.parse(row.fingerprint) as StyleFingerprint }] : [];
  });
}
