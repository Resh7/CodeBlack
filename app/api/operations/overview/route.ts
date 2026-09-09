import { getD1 } from "@/db";
import { loadIntegrationState } from "@/lib/integrations";

export async function GET(request: Request) {
  const integrationState = await loadIntegrationState();
  const environment =
    new URL(request.url).searchParams.get("environment")?.trim() || "LOCAL";
  const integrations = integrationState.integrations.filter(
    (item) => item.environment === environment,
  );
  try {
    const db = getD1();
    const [
      catalog,
      imports,
      validations,
      validationStats,
      recentRuns,
      recentAudit,
    ] = await Promise.all([
      db
        .prepare(
          "SELECT definition_kind AS kind, COUNT(*) AS count FROM job_definitions WHERE active = 1 GROUP BY definition_kind",
        )
        .all<{ kind: string; count: number }>(),
      db
        .prepare(
          "SELECT import_kind AS kind, filename, uploaded_at AS uploadedAt, row_count AS rowCount FROM workbook_imports WHERE status = 'Active' ORDER BY uploaded_at DESC",
        )
        .all(),
      db
        .prepare("SELECT COUNT(*) AS count FROM validation_runs")
        .first<{ count: number }>(),
      db
        .prepare(
          `SELECT status, COUNT(*) AS count, AVG(duration_ms) AS averageDurationMs
         FROM validation_runs GROUP BY status`,
        )
        .all<{
          status: string;
          count: number;
          averageDurationMs: number | null;
        }>(),
      db
        .prepare(
          `SELECT id, job_id AS jobId, job_name AS jobName, phase, status, result_count AS resultCount,
                message, duration_ms AS durationMs, correlation_id AS correlationId,
                executed_at AS executedAt, executed_by AS executedBy
         FROM validation_runs ORDER BY executed_at DESC LIMIT 50`,
        )
        .all(),
      db
        .prepare(
          `SELECT id, event_type AS eventType, actor_id AS actorId, environment, integration,
                target_id AS targetId, result, duration_ms AS durationMs, row_count AS rowCount,
                correlation_id AS correlationId, occurred_at AS occurredAt
         FROM integration_audit_events ORDER BY occurred_at DESC LIMIT 50`,
        )
        .all(),
    ]);
    const catalogCounts = Object.fromEntries(
      catalog.results.map((row) => [row.kind, Number(row.count)]),
    );
    return Response.json({
      integrations,
      storageAvailable: integrationState.storageAvailable,
      storageWarning: integrationState.storageWarning,
      metrics: {
        connectedIntegrations: integrations.filter(
          (item) => item.status === "CONNECTED",
        ).length,
        configuredIntegrations: integrations.filter(
          (item) => !["NOT_CONFIGURED", "DISABLED"].includes(item.status),
        ).length,
        totalIntegrations: integrations.length,
        activeWorkbookSources: imports.results.length,
        activeCatalogJobs: Object.values(catalogCounts).reduce(
          (total, value) => total + value,
          0,
        ),
        validationRuns: Number(validations?.count ?? 0),
      },
      catalogCounts,
      activeImports: imports.results,
      validationStats: validationStats.results,
      recentRuns: recentRuns.results,
      recentAudit: recentAudit.results,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({
      integrations,
      storageAvailable: false,
      storageWarning:
        error instanceof Error
          ? error.message
          : "Operational storage is unavailable.",
      metrics: {
        connectedIntegrations: integrations.filter(
          (item) => item.status === "CONNECTED",
        ).length,
        configuredIntegrations: integrations.filter(
          (item) => !["NOT_CONFIGURED", "DISABLED"].includes(item.status),
        ).length,
        totalIntegrations: integrations.length,
        activeWorkbookSources: 0,
        activeCatalogJobs: 0,
        validationRuns: 0,
      },
      catalogCounts: {},
      activeImports: [],
      validationStats: [],
      recentRuns: [],
      recentAudit: [],
      generatedAt: new Date().toISOString(),
    });
  }
}
