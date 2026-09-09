import { getD1 } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";

export async function GET(request: Request) {
  try {
    await ensureDatabaseSchema();
    const params = new URL(request.url).searchParams;
    const limit = Math.min(Math.max(Number(params.get("limit") || 100), 1), 250);
    const query = params.get("q")?.trim() ?? "";
    const statement = query
      ? getD1().prepare(
          `SELECT id, event_type AS eventType, actor_id AS actorId, environment, integration,
                  target_id AS targetId, result, duration_ms AS durationMs, row_count AS rowCount,
                  correlation_id AS correlationId, detail_json AS detailJson, occurred_at AS occurredAt
           FROM integration_audit_events
           WHERE event_type LIKE ? ESCAPE '\\' OR target_id LIKE ? ESCAPE '\\' OR correlation_id LIKE ? ESCAPE '\\'
           ORDER BY occurred_at DESC LIMIT ?`,
        ).bind(...Array(3).fill(`%${query.replace(/[\\%_]/g, "\\$&")}%`), limit)
      : getD1().prepare(
          `SELECT id, event_type AS eventType, actor_id AS actorId, environment, integration,
                  target_id AS targetId, result, duration_ms AS durationMs, row_count AS rowCount,
                  correlation_id AS correlationId, detail_json AS detailJson, occurred_at AS occurredAt
           FROM integration_audit_events ORDER BY occurred_at DESC LIMIT ?`,
        ).bind(limit);
    const events = await statement.all();
    return Response.json({ events: events.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load audit events." }, { status: 500 });
  }
}
