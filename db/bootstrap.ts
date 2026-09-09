import { getD1 } from "@/db";

const CURRENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS application_settings (
  key TEXT PRIMARY KEY NOT NULL,
  category TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workbook_imports (
  id TEXT PRIMARY KEY NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  uploaded_by TEXT NOT NULL,
  import_kind TEXT DEFAULT 'VALIDATION' NOT NULL,
  status TEXT NOT NULL,
  sheet_count INTEGER DEFAULT 0 NOT NULL,
  row_count INTEGER DEFAULT 0 NOT NULL,
  column_count INTEGER DEFAULT 0 NOT NULL,
  sheets_json TEXT DEFAULT '[]' NOT NULL,
  columns_json TEXT DEFAULT '[]' NOT NULL,
  changes_json TEXT DEFAULT '{}' NOT NULL
);
CREATE INDEX IF NOT EXISTS workbook_imports_uploaded_at_idx ON workbook_imports (uploaded_at);
CREATE TABLE IF NOT EXISTS job_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  job_name TEXT NOT NULL,
  description TEXT DEFAULT '' NOT NULL,
  pre_validation TEXT DEFAULT '' NOT NULL,
  post_validation TEXT DEFAULT '' NOT NULL,
  comment TEXT DEFAULT '' NOT NULL,
  pre_instructions TEXT DEFAULT '' NOT NULL,
  post_instructions TEXT DEFAULT '' NOT NULL,
  raw_json TEXT NOT NULL,
  active INTEGER DEFAULT 1 NOT NULL,
  definition_kind TEXT DEFAULT 'VALIDATION' NOT NULL,
  source_import_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS job_definitions_name_idx ON job_definitions (job_name);
CREATE INDEX IF NOT EXISTS job_definitions_source_idx ON job_definitions (source_import_id);
CREATE TABLE IF NOT EXISTS validation_runs (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  job_name TEXT NOT NULL,
  phase TEXT NOT NULL,
  query_type TEXT DEFAULT 'SQL' NOT NULL,
  status TEXT NOT NULL,
  result_count INTEGER,
  message TEXT NOT NULL,
  duration_ms INTEGER,
  correlation_id TEXT,
  executed_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  executed_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS validation_runs_job_idx ON validation_runs (job_id, executed_at);
CREATE TABLE IF NOT EXISTS integration_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  integration TEXT NOT NULL,
  target_id TEXT NOT NULL,
  result TEXT NOT NULL,
  duration_ms INTEGER,
  row_count INTEGER,
  correlation_id TEXT NOT NULL,
  detail_json TEXT DEFAULT '{}' NOT NULL,
  occurred_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS integration_audit_target_idx ON integration_audit_events (target_id, occurred_at);
CREATE INDEX IF NOT EXISTS integration_audit_time_idx ON integration_audit_events (occurred_at);
CREATE TABLE IF NOT EXISTS integration_connections (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  environment TEXT NOT NULL,
  description TEXT NOT NULL,
  enabled INTEGER DEFAULT 1 NOT NULL,
  non_secret_config_json TEXT DEFAULT '{}' NOT NULL,
  secret_reference TEXT NOT NULL,
  status TEXT DEFAULT 'NOT_CONFIGURED' NOT NULL,
  last_tested_at TEXT,
  last_latency_ms INTEGER,
  capabilities_json TEXT DEFAULT '[]' NOT NULL,
  last_error_category TEXT,
  last_diagnostic TEXT,
  last_correlation_id TEXT,
  config_version INTEGER DEFAULT 1 NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS integration_connections_type_idx ON integration_connections (type);
CREATE INDEX IF NOT EXISTS integration_connections_status_idx ON integration_connections (status);
`;

const LEGACY_COLUMNS: Array<{ table: string; column: string; sql: string }> = [
  {
    table: "job_definitions",
    column: "definition_kind",
    sql: "ALTER TABLE job_definitions ADD definition_kind TEXT DEFAULT 'VALIDATION' NOT NULL",
  },
  {
    table: "workbook_imports",
    column: "import_kind",
    sql: "ALTER TABLE workbook_imports ADD import_kind TEXT DEFAULT 'VALIDATION' NOT NULL",
  },
  {
    table: "validation_runs",
    column: "duration_ms",
    sql: "ALTER TABLE validation_runs ADD duration_ms INTEGER",
  },
  {
    table: "validation_runs",
    column: "correlation_id",
    sql: "ALTER TABLE validation_runs ADD correlation_id TEXT",
  },
  {
    table: "validation_runs",
    column: "query_type",
    sql: "ALTER TABLE validation_runs ADD query_type TEXT DEFAULT 'SQL' NOT NULL",
  },
];

let schemaPromise: Promise<void> | null = null;

async function bootstrap() {
  const db = getD1();
  const statements = CURRENT_SCHEMA.split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => db.prepare(statement));
  await db.batch(statements);
  for (const migration of LEGACY_COLUMNS) {
    const columns = await db
      .prepare(`PRAGMA table_info(${migration.table})`)
      .all<{ name: string }>();
    if (!columns.results.some((column) => column.name === migration.column)) {
      await db.prepare(migration.sql).run();
    }
  }
}

export async function ensureDatabaseSchema() {
  schemaPromise ??= bootstrap().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  await schemaPromise;
}
