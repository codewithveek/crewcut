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
    {
      // Autopilot: the crew makes the whole video without stopping at the gates (publishing stays with a person).
      version: 7,
      name: "crewcut-autopilot",
      sql: `ALTER TABLE videos ADD COLUMN IF NOT EXISTS autopilot TEXT NOT NULL DEFAULT '{}'`,
    },
    {
      // Crewcut AI and billing: what each AI call and voice-over costs (the admin
      // cost page), credit balances and their ledger, and Bachs subscriptions.
      version: 8,
      name: "crewcut-ai-usage-credits-billing",
      sql: [
        `CREATE TABLE IF NOT EXISTS ai_usage (
          id TEXT PRIMARY KEY, workspace TEXT NOT NULL, owner_email TEXT NOT NULL, org_id TEXT, source TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'llm',
          provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, units INTEGER NOT NULL DEFAULT 0,
          cost_micros INTEGER NOT NULL DEFAULT 0, millicredits INTEGER NOT NULL DEFAULT 0, video_id TEXT, stage TEXT NOT NULL DEFAULT 'chat',
          thread_id TEXT, run_id TEXT, duration_ms INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL DEFAULT now())`,
        "CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at)",
        "CREATE INDEX IF NOT EXISTS ai_usage_video_idx ON ai_usage (video_id, created_at)",
        "CREATE INDEX IF NOT EXISTS ai_usage_workspace_idx ON ai_usage (workspace, created_at)",
        `CREATE TABLE IF NOT EXISTS credit_balances (
          workspace TEXT PRIMARY KEY, plan TEXT NOT NULL DEFAULT 'free', period_start TEXT NOT NULL, period_end TEXT NOT NULL,
          monthly_millicredits INTEGER NOT NULL DEFAULT 0, topup_millicredits INTEGER NOT NULL DEFAULT 0, topup_expires_at TEXT,
          updated_at TEXT NOT NULL DEFAULT now())`,
        `CREATE TABLE IF NOT EXISTS credit_ledger (
          id TEXT PRIMARY KEY, workspace TEXT NOT NULL, kind TEXT NOT NULL, pool TEXT NOT NULL DEFAULT 'monthly', millicredits INTEGER NOT NULL,
          ref TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT now())`,
        "CREATE INDEX IF NOT EXISTS credit_ledger_workspace_idx ON credit_ledger (workspace, created_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_ref_idx ON credit_ledger (kind, ref) WHERE ref <> ''",
        `CREATE TABLE IF NOT EXISTS billing_customers (
          workspace TEXT PRIMARY KEY, customer_id TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT now())`,
        "CREATE UNIQUE INDEX IF NOT EXISTS billing_customers_customer_idx ON billing_customers (customer_id)",
        `CREATE TABLE IF NOT EXISTS billing_checkouts (
          id TEXT PRIMARY KEY, workspace TEXT NOT NULL, kind TEXT NOT NULL, item TEXT NOT NULL, billing_interval TEXT, session_id TEXT,
          status TEXT NOT NULL DEFAULT 'open', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT now(), completed_at TEXT)`,
        "CREATE INDEX IF NOT EXISTS billing_checkouts_session_idx ON billing_checkouts (session_id)",
        `CREATE TABLE IF NOT EXISTS billing_subscriptions (
          id TEXT PRIMARY KEY, workspace TEXT NOT NULL, plan TEXT NOT NULL, billing_interval TEXT NOT NULL DEFAULT 'month', status TEXT NOT NULL,
          product_id TEXT NOT NULL DEFAULT '', current_period_end TEXT, cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
          updated_at TEXT NOT NULL DEFAULT now())`,
        "CREATE INDEX IF NOT EXISTS billing_subscriptions_workspace_idx ON billing_subscriptions (workspace)",
        `CREATE TABLE IF NOT EXISTS billing_events (
          id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT now(), processed_at TEXT, error TEXT)`,
      ].join(";\n"),
    },
    {
      // A paying workspace's credit period follows its Bachs billing period.
      version: 9,
      name: "crewcut-credit-period-source",
      sql: `ALTER TABLE credit_balances ADD COLUMN IF NOT EXISTS period_source TEXT NOT NULL DEFAULT 'calendar'`,
    },
    {
      // One row per video and version, so two edits saved at the same moment
      // can't both become "version 12" (one of them was then lost). Videos
      // that already have such twins keep them: the index is only made when
      // there are none, and the app works as before without it.
      version: 10,
      name: "crewcut-composition-version-unique",
      sql: {},
      run: async (exec) => {
        const { rows } = await exec.execute("SELECT count(*)::int AS twins FROM (SELECT 1 FROM compositions GROUP BY video_id, version HAVING count(*) > 1) t");
        const twins = Number((rows[0] as { twins?: unknown } | undefined)?.twins ?? 0);
        if (twins > 0) {
          console.warn(`[db] ${twins} video version(s) were saved twice by simultaneous edits; versions stay non-unique until those are cleaned up.`);
          return;
        }
        await exec.execute("CREATE UNIQUE INDEX IF NOT EXISTS compositions_video_version_unique ON compositions (video_id, version)");
      },
    },
    {
      // Webhooks can arrive out of order: remember how new the latest applied one was.
      version: 11,
      name: "crewcut-billing-event-order",
      sql: `ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS last_event_at TEXT`,
    },
  ],
  { table: "crewcut_migrations" },
);
