import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workbookImports = sqliteTable(
  "workbook_imports",
  {
    id: text("id").primaryKey(),
    filename: text("filename").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    uploadedAt: text("uploaded_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    uploadedBy: text("uploaded_by").notNull(),
    importKind: text("import_kind").notNull().default("VALIDATION"),
    status: text("status").notNull(),
    sheetCount: integer("sheet_count").notNull().default(0),
    rowCount: integer("row_count").notNull().default(0),
    columnCount: integer("column_count").notNull().default(0),
    sheetsJson: text("sheets_json").notNull().default("[]"),
    columnsJson: text("columns_json").notNull().default("[]"),
    changesJson: text("changes_json").notNull().default("{}"),
  },
  (table) => [index("workbook_imports_uploaded_at_idx").on(table.uploadedAt)],
);

export const jobDefinitions = sqliteTable(
  "job_definitions",
  {
    id: text("id").primaryKey(),
    jobName: text("job_name").notNull(),
    description: text("description").notNull().default(""),
    preValidation: text("pre_validation").notNull().default(""),
    postValidation: text("post_validation").notNull().default(""),
    comment: text("comment").notNull().default(""),
    preInstructions: text("pre_instructions").notNull().default(""),
    postInstructions: text("post_instructions").notNull().default(""),
    rawJson: text("raw_json").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    definitionKind: text("definition_kind").notNull().default("VALIDATION"),
    sourceImportId: text("source_import_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("job_definitions_name_idx").on(table.jobName),
    index("job_definitions_source_idx").on(table.sourceImportId),
  ],
);

export const applicationSettings = sqliteTable("application_settings", {
  key: text("key").primaryKey(),
  category: text("category").notNull(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by").notNull(),
});

export const validationRuns = sqliteTable(
  "validation_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    jobName: text("job_name").notNull(),
    phase: text("phase").notNull(),
    queryType: text("query_type").notNull().default("SQL"),
    status: text("status").notNull(),
    resultCount: integer("result_count"),
    message: text("message").notNull(),
    durationMs: integer("duration_ms"),
    correlationId: text("correlation_id"),
    executedAt: text("executed_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    executedBy: text("executed_by").notNull(),
  },
  (table) => [
    index("validation_runs_job_idx").on(table.jobId, table.executedAt),
  ],
);

export const integrationConnections = sqliteTable(
  "integration_connections",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    displayName: text("display_name").notNull(),
    environment: text("environment").notNull(),
    description: text("description").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    nonSecretConfigJson: text("non_secret_config_json").notNull().default("{}"),
    secretReference: text("secret_reference").notNull(),
    status: text("status").notNull().default("NOT_CONFIGURED"),
    lastTestedAt: text("last_tested_at"),
    lastLatencyMs: integer("last_latency_ms"),
    capabilitiesJson: text("capabilities_json").notNull().default("[]"),
    lastErrorCategory: text("last_error_category"),
    lastDiagnostic: text("last_diagnostic"),
    lastCorrelationId: text("last_correlation_id"),
    configVersion: integer("config_version").notNull().default(1),
    updatedBy: text("updated_by").notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("integration_connections_type_idx").on(table.type),
    index("integration_connections_status_idx").on(table.status),
  ],
);

export const integrationAuditEvents = sqliteTable(
  "integration_audit_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    actorId: text("actor_id").notNull(),
    environment: text("environment").notNull(),
    integration: text("integration").notNull(),
    targetId: text("target_id").notNull(),
    result: text("result").notNull(),
    durationMs: integer("duration_ms"),
    rowCount: integer("row_count"),
    correlationId: text("correlation_id").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    occurredAt: text("occurred_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("integration_audit_target_idx").on(table.targetId, table.occurredAt),
    index("integration_audit_time_idx").on(table.occurredAt),
  ],
);
