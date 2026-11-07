import {
  boolean,
  createSharesTable,
  integer,
  now,
  ownableColumns,
  real,
  table,
  text,
} from "@agent-native/core/db/schema";

/**
 * Crewcut's data model (masterplan "Data model and action catalog"). Every
 * table carries owner_email / org_id / visibility via ownableColumns(); JSON
 * documents are stored as text and parsed with Zod whenever they're read.
 * Agents and people change these rows only through actions.
 */

export const projects = table("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  niche: text("niche").notNull().default(""),
  /** BrandKit JSON: locked colours, fonts, words to use/avoid. */
  brandKit: text("brand_kit").notNull().default("{}"),
  /** GatePolicy JSON. */
  gatePolicy: text("gate_policy").notNull().default("{}"),
  varietyThreshold: real("variety_threshold").notNull().default(0.72),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});
export const projectShares = createSharesTable("project_shares");

export const videos = table("videos", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  /** The person's starting prompt. */
  brief: text("brief").notNull().default(""),
  ratio: text("ratio").notNull().default("16:9"),
  platforms: text("platforms").notNull().default('["youtube"]'),
  /** StageStates JSON. */
  stages: text("stages").notNull(),
  /** Idea[] JSON from the trend agent, and the picked one. */
  ideas: text("ideas").notNull().default("[]"),
  pickedIdeaId: text("picked_idea_id"),
  seed: integer("seed").notNull().default(1),
  scriptVersion: integer("script_version").notNull().default(0),
  compositionVersion: integer("composition_version").notNull().default(0),
  consistencyRequested: boolean("consistency_requested").notNull().default(false),
  /** "draft" | "published" | "sample". */
  status: text("status").notNull().default("draft"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});
export const videoShares = createSharesTable("video_shares");

export const sources = table("sources", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  publisher: text("publisher"),
  /** Redacted plain text; facts are verified against this. */
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  redactions: integer("redactions").notNull().default(0),
  retrievedAt: text("retrieved_at").notNull().default(now()),
  ...ownableColumns(),
});

export const dossiers = table("dossiers", {
  videoId: text("video_id").primaryKey(),
  body: text("body").notNull(),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const scripts = table("scripts", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  version: integer("version").notNull(),
  body: text("body").notNull(),
  authorKind: text("author_kind").notNull(),
  author: text("author").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

export const claimAudits = table("claim_audits", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  scriptVersion: integer("script_version").notNull(),
  report: text("report").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

export const qaReports = table("qa_reports", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  scriptVersion: integer("script_version").notNull(),
  compositionVersion: integer("composition_version").notNull().default(0),
  report: text("report").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

export const compositions = table("compositions", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  version: integer("version").notNull(),
  body: text("body").notNull(),
  fingerprint: text("fingerprint").notNull(),
  /** One undoable step: "Trim scene-2", "Agent: make the hook punchier". */
  label: text("label").notNull(),
  authorKind: text("author_kind").notNull(),
  author: text("author").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

export const assets = table("assets", {
  id: text("id").primaryKey(),
  videoId: text("video_id"),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  fileName: text("file_name").notNull(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull().default(0),
  durationMs: integer("duration_ms"),
  /** { name, commercialUse, aiGenerated } */
  licence: text("licence").notNull(),
  /** { provider, prompt?, sourceUrl? } */
  provenance: text("provenance").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

/**
 * Where a stored file actually lives when it is not on this host's disk:
 * Agent-Native's file storage (Builder, S3, Cloudflare R2, MinIO…). Keyed by
 * "<area>/<fileName>", the same names local storage uses.
 */
export const storedFiles = table("stored_files", {
  key: text("key").primaryKey(),
  area: text("area").notNull(),
  fileName: text("file_name").notNull(),
  provider: text("provider").notNull(),
  url: text("url").notNull(),
  remoteId: text("remote_id"),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
});

// ── Content catalog ─────────────────────────────────────────────────────────

/** A group of catalog items (templates, music, sounds) shown together, Free or Pro. */
export const catalogPacks = table("catalog_packs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** free | pro */
  tier: text("tier").notNull().default("free"),
  /** draft | published */
  status: text("status").notNull().default("draft"),
  sort: integer("sort").notNull().default(0),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

/**
 * A template, music track or sound. scope "catalog" items are published by
 * admins for everyone (in a pack); scope "workspace" items are people's own
 * saved templates, seen by their workspace. Published content lives in
 * immutable versions; `draft` holds unpublished edits.
 */
export const catalogItems = table("catalog_items", {
  id: text("id").primaryKey(),
  /** catalog | workspace */
  scope: text("scope").notNull().default("catalog"),
  packId: text("pack_id"),
  /** template | music | sound */
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default(""),
  /** JSON string[] */
  tags: text("tags").notNull().default("[]"),
  /** draft | published | archived */
  status: text("status").notNull().default("draft"),
  sort: integer("sort").notNull().default(0),
  /** The published version people get (0 = never published). */
  currentVersion: integer("current_version").notNull().default(0),
  /** JSON payload being prepared, published as the next version. */
  draft: text("draft").notNull().default("{}"),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

/** Published content, never changed once written: projects made from it keep working. */
export const catalogItemVersions = table("catalog_item_versions", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  version: integer("version").notNull(),
  payload: text("payload").notNull(),
  publishedBy: text("published_by").notNull().default(""),
  publishedAt: text("published_at").notNull().default(now()),
});

/** Free or Pro, per workspace (an organisation id, or "user:<email>" for a personal workspace). */
export const workspacePlans = table("workspace_plans", {
  workspace: text("workspace").primaryKey(),
  plan: text("plan").notNull().default("free"),
  source: text("source").notNull().default("manual"),
  note: text("note").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const renderJobs = table("render_jobs", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  compositionVersion: integer("composition_version").notNull(),
  ratio: text("ratio").notNull(),
  /** queued | running | done | failed | cancelled */
  status: text("status").notNull().default("queued"),
  progress: real("progress").notNull().default(0),
  stage: text("stage").notNull().default("queued"),
  payload: text("payload").notNull(),
  outputFile: text("output_file"),
  outputBytes: integer("output_bytes"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  lockedBy: text("locked_by"),
  lockedAt: text("locked_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const connections = table("connections", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  accountName: text("account_name").notNull(),
  accountId: text("account_id").notNull().default(""),
  scopes: text("scopes").notNull().default(""),
  /** healthy | expiring | failed | revoked */
  status: text("status").notNull().default("healthy"),
  statusDetail: text("status_detail").notNull().default(""),
  lastUsedAt: text("last_used_at"),
  /** Key in the encrypted credential vault — the tokens never live here. */
  vaultKey: text("vault_key").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

export const publishJobs = table("publish_jobs", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  renderJobId: text("render_job_id").notNull(),
  platform: text("platform").notNull(),
  connectionId: text("connection_id"),
  copy: text("copy").notNull(),
  privacy: text("privacy").notNull().default("private"),
  scheduledAt: text("scheduled_at"),
  /** awaiting_approval | uploading | published | failed | cancelled */
  status: text("status").notNull().default("awaiting_approval"),
  platformPostId: text("platform_post_id"),
  url: text("url"),
  warnings: text("warnings").notNull().default("[]"),
  error: text("error"),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

export const metricSnapshots = table("metric_snapshots", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  window: text("window").notNull(),
  metrics: text("metrics").notNull(),
  /** youtube | sample */
  source: text("source").notNull(),
  capturedAt: text("captured_at").notNull().default(now()),
  ...ownableColumns(),
});

export const insights = table("insights", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  window: text("window").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

export const learnings = table("learnings", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  scope: text("scope").notNull(),
  text: text("text").notNull(),
  evidence: text("evidence").notNull().default(""),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

/** The authorship log: every approval, override, send-back and publish, by whom and why. */
export const approvalEvents = table("approval_events", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  stage: text("stage").notNull(),
  actorKind: text("actor_kind").notNull(),
  actor: text("actor").notNull(),
  decision: text("decision").notNull(),
  reason: text("reason"),
  subject: text("subject"),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});
