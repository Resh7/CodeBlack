import { getD1 } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabaseSchema();
    const { id } = await context.params;
    const rows = await getD1().prepare(
      `SELECT id, event_type AS eventType, actor_id AS actorId, environment,
              integration, target_id AS targetId, result, duration_ms AS durationMs,
              row_count AS rowCount, correlation_id AS correlationId,
              detail_json AS detailJson, occurred_at AS occurredAt
       FROM integration_audit_events
       WHERE target_id = ?
       ORDER BY occurred_at DESC
       LIMIT 100`,
    ).bind(id).all<Record<string, unknown> & { detailJson: string }>();
    return Response.json({
      events: rows.results.map((row) => ({ ...row, detail: JSON.parse(row.detailJson), detailJson: undefined })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load connector audit history." },
      { status: 500 },
    );
  }
}
