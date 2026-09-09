import { getD1 } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";

export async function POST(request: Request) {
  try {
    await ensureDatabaseSchema();
    const payload = (await request.json()) as {
      jobId?: string;
      phase?: "PRE" | "POST";
      queryType?: "SQL" | "MONGO";
      resultCount?: number | null;
      message?: string;
      durationMs?: number;
    };
    if (!payload.jobId || !["PRE", "POST"].includes(payload.phase ?? ""))
      return Response.json(
        { error: "A validation job and phase are required." },
        { status: 400 },
      );
    if (
      payload.resultCount != null &&
      (!Number.isInteger(payload.resultCount) ||
        payload.resultCount < 0 ||
        payload.resultCount > 10_000_000)
    )
      return Response.json(
        { error: "Invalid local result count." },
        { status: 400 },
      );
    const job = await getD1()
      .prepare(
        "SELECT job_name AS jobName FROM job_definitions WHERE id = ? AND active = 1 AND definition_kind = 'VALIDATION'",
      )
      .bind(payload.jobId)
      .first<{ jobName: string }>();
    if (!job)
      return Response.json(
        { error: "Validation definition was not found." },
        { status: 404 },
      );
    const id = crypto.randomUUID();
    await getD1()
      .prepare(
        `INSERT INTO validation_runs (id, job_id, job_name, phase, query_type, status, result_count, message, duration_ms, correlation_id, executed_by)
       VALUES (?, ?, ?, ?, ?, 'SUCCESS', ?, ?, ?, ?, 'Local BES connector')`,
      )
      .bind(
        id,
        payload.jobId,
        job.jobName,
        payload.phase,
        payload.queryType === "MONGO" ? "MONGO" : "SQL",
        payload.resultCount ?? null,
        String(
          payload.message ?? "Local read-only validation completed.",
        ).slice(0, 2000),
        Math.max(0, Math.min(Number(payload.durationMs ?? 0), 120_000)),
        `local_${crypto.randomUUID()}`,
      )
      .run();
    return Response.json({ ok: true, runId: id });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to record local validation result.",
      },
      { status: 500 },
    );
  }
}
