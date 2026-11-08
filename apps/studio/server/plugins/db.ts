import { runMigrations } from "@agent-native/core/db";

const OWNABLE = `owner_email TEXT NOT NULL DEFAULT 'local@localhost', org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private'`;

const shares = (name: string) => `CREATE TABLE IF NOT EXISTS ${name} (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT now(),
  notified_at TEXT
)`;

/** Crewcut's tables. Additive only: never drop or rename a column here. */
export default runMigrations(
  [
    {
      version: 1,
      name: "crewcut-core-tables",
      sql: [
        `CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, niche TEXT NOT NULL DEFAULT '', brand_kit TEXT NOT NULL DEFAULT '{}',
          gate_policy TEXT NOT NULL DEFAULT '{}', variety_threshold REAL NOT NULL DEFAULT 0.72, is_demo BOOLEAN NOT NULL DEFAULT false,
          created_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        shares("project_shares"),
        `CREATE TABLE IF NOT EXISTS videos (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, brief TEXT NOT NULL DEFAULT '', ratio TEXT NOT NULL DEFAULT '16:9',
          platforms TEXT NOT NULL DEFAULT '["youtube"]', stages TEXT NOT NULL, ideas TEXT NOT NULL DEFAULT '[]', picked_idea_id TEXT,
          seed INTEGER NOT NULL DEFAULT 1, script_version INTEGER NOT NULL DEFAULT 0, composition_version INTEGER NOT NULL DEFAULT 0,
          consistency_requested BOOLEAN NOT NULL DEFAULT false, status TEXT NOT NULL DEFAULT 'draft', is_demo BOOLEAN NOT NULL DEFAULT false,
          created_at TEXT NOT NULL DEFAULT now(), updated_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        shares("video_shares"),
        `CREATE TABLE IF NOT EXISTS sources (
          id TEXT PRIMARY KEY, video_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, url TEXT, publisher TEXT, content TEXT NOT NULL,
          content_hash TEXT NOT NULL, redactions INTEGER NOT NULL DEFAULT 0, retrieved_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS dossiers (video_id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS scripts (
          id TEXT PRIMARY KEY, video_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, author_kind TEXT NOT NULL, author TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS claim_audits (
          id TEXT PRIMARY KEY, video_id TEXT NOT NULL, script_version INTEGER NOT NULL, report TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS qa_reports (
          id TEXT PRIMARY KEY, video_id TEXT NOT NULL, script_version INTEGER NOT NULL, composition_version INTEGER NOT NULL DEFAULT 0,
          report TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS compositions (
          id TEXT PRIMARY KEY, video_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, fingerprint TEXT NOT NULL, label TEXT NOT NULL,
          author_kind TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY, video_id TEXT, kind TEXT NOT NULL, label TEXT NOT NULL, file_name TEXT NOT NULL, mime TEXT NOT NULL,
          bytes INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER, licence TEXT NOT NULL, provenance TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS render_jobs (
          id TEXT PRIMARY KEY, video_id TEXT NOT NULL, composition_version INTEGER NOT NULL, ratio TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
          progress REAL NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'queued', payload TEXT NOT NULL, output_file TEXT, output_bytes INTEGER, error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0, locked_by TEXT, locked_at TEXT, created_at TEXT NOT NULL DEFAULT now(),
          updated_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS connections (
          id TEXT PRIMARY KEY, provider TEXT NOT NULL, account_name TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '', scopes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'healthy', status_detail TEXT NOT NULL DEFAULT '', last_used_at TEXT, vault_key TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS publish_jobs (
          id TEXT PRIMARY KEY, video_id TEXT NOT NULL, render_job_id TEXT NOT NULL, platform TEXT NOT NULL, connection_id TEXT, copy TEXT NOT NULL,
          privacy TEXT NOT NULL DEFAULT 'private', scheduled_at TEXT, status TEXT NOT NULL DEFAULT 'awaiting_approval', platform_post_id TEXT, url TEXT,
          warnings TEXT NOT NULL DEFAULT '[]', error TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS metric_snapshots (
          id TEXT PRIMARY KEY, video_id TEXT NOT NULL, "window" TEXT NOT NULL, metrics TEXT NOT NULL, source TEXT NOT NULL,
          captured_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS insights (
          id TEXT PRIMARY KEY, video_id TEXT NOT NULL, "window" TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS learnings (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scope TEXT NOT NULL, text TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS approval_events (
          id TEXT PRIMARY KEY, video_id TEXT NOT NULL, stage TEXT NOT NULL, actor_kind TEXT NOT NULL, actor TEXT NOT NULL, decision TEXT NOT NULL,
          reason TEXT, subject TEXT, created_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
      ].join(";\n"),
    },
    {
      version: 2,
      name: "crewcut-indexes",
      sql: [
        "CREATE INDEX IF NOT EXISTS videos_project_idx ON videos (project_id)",
        "CREATE INDEX IF NOT EXISTS scripts_video_idx ON scripts (video_id, version)",
        "CREATE INDEX IF NOT EXISTS compositions_video_idx ON compositions (video_id, version)",
        "CREATE INDEX IF NOT EXISTS render_jobs_status_idx ON render_jobs (status, created_at)",
        "CREATE INDEX IF NOT EXISTS approval_events_video_idx ON approval_events (video_id, created_at)",
        "CREATE INDEX IF NOT EXISTS video_shares_resource_idx ON video_shares (resource_id)",
        "CREATE INDEX IF NOT EXISTS project_shares_resource_idx ON project_shares (resource_id)",
      ].join(";\n"),
    },
    {
      version: 3,
      name: "crewcut-stored-files",
      sql: [
        `CREATE TABLE IF NOT EXISTS stored_files (
          key TEXT PRIMARY KEY, area TEXT NOT NULL, file_name TEXT NOT NULL, provider TEXT NOT NULL, url TEXT NOT NULL,
          remote_id TEXT, mime TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT now())`,
      ].join(";\n"),
    },
    {
      // The content catalog (templates, music, sounds in Free/Pro packs) and people's own saved templates.
      version: 4,
      name: "crewcut-catalog",
      sql: [
        `CREATE TABLE IF NOT EXISTS catalog_packs (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', tier TEXT NOT NULL DEFAULT 'free',
          status TEXT NOT NULL DEFAULT 'draft', sort INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT now(), updated_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS catalog_items (
          id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT 'catalog', pack_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'draft', sort INTEGER NOT NULL DEFAULT 0, current_version INTEGER NOT NULL DEFAULT 0,
          draft TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT now(),
          updated_at TEXT NOT NULL DEFAULT now(), ${OWNABLE})`,
        `CREATE TABLE IF NOT EXISTS catalog_item_versions (
          id TEXT PRIMARY KEY, item_id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL,
          published_by TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL DEFAULT now())`,
        `CREATE TABLE IF NOT EXISTS workspace_plans (
          workspace TEXT PRIMARY KEY, plan TEXT NOT NULL DEFAULT 'free', source TEXT NOT NULL DEFAULT 'manual',
          note TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT now())`,
        "CREATE INDEX IF NOT EXISTS catalog_items_scope_idx ON catalog_items (scope, kind, status)",
        "CREATE INDEX IF NOT EXISTS catalog_items_pack_idx ON catalog_items (pack_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS catalog_item_versions_idx ON catalog_item_versions (item_id, version)",
      ].join(";\n"),
    },
    {
      // Every per-video read (get-video, the proof report, the editor) filters
      // these tables by video; without an index each one scanned the table.
      // Owner lookups compare emails exactly, so the framework's lower(owner_email)
      // indexes don't serve them.
      version: 5,
      name: "crewcut-read-path-indexes",
      sql: [
        "CREATE INDEX IF NOT EXISTS sources_video_idx ON sources (video_id, retrieved_at)",
        "CREATE INDEX IF NOT EXISTS assets_video_idx ON assets (video_id)",
        "CREATE INDEX IF NOT EXISTS assets_owner_idx ON assets (owner_email, video_id)",
        "CREATE INDEX IF NOT EXISTS render_jobs_video_idx ON render_jobs (video_id, created_at)",
        "CREATE INDEX IF NOT EXISTS publish_jobs_video_idx ON publish_jobs (video_id, created_at)",
        "CREATE INDEX IF NOT EXISTS claim_audits_video_idx ON claim_audits (video_id, created_at)",
        "CREATE INDEX IF NOT EXISTS qa_reports_video_idx ON qa_reports (video_id, created_at)",
        "CREATE INDEX IF NOT EXISTS insights_video_idx ON insights (video_id, created_at)",
        "CREATE INDEX IF NOT EXISTS metric_snapshots_video_idx ON metric_snapshots (video_id, captured_at)",
        "CREATE INDEX IF NOT EXISTS learnings_project_idx ON learnings (project_id)",
        "CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects (owner_email, created_at)",
        "CREATE INDEX IF NOT EXISTS videos_updated_idx ON videos (updated_at)",
        "CREATE INDEX IF NOT EXISTS connections_owner_idx ON connections (owner_email, provider)",
        "CREATE INDEX IF NOT EXISTS catalog_items_owner_idx ON catalog_items (owner_email, scope)",
      ].join(";\n"),
    },
    {
      // Email (Resend) arrived on 2026-11-08, and with it the framework requires
      // verified emails to sign in. Accounts made before that were never sent a
      // verification email, so they count as verified (agreed with the
      // operator) instead of being locked out. Runs once, before the new code
      // serves requests: every account created later goes through verification.
      version: 6,
      name: "crewcut-verify-accounts-before-email",
      sql: {},
      run: async (exec) => {
        const { rows } = await exec.execute(`SELECT to_regclass('public."user"')::text AS name`);
        if (!rows[0]?.name) return; // A new database: no accounts yet.
        const result = await exec.execute(`UPDATE "user" SET email_verified = true WHERE email_verified = false AND created_at < now()`);
        console.log(`[db] Marked ${result.rowsAffected} account(s) from before email verification as verified`);
      },
    },
  ],
  { table: "crewcut_migrations" },
);
