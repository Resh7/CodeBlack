import { getD1 } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";
import { checkReadOnlySql } from "@/lib/sql-query-tools";

type Context = { params: Promise<{ id: string }> };

function actor(request: Request) {
  return (
    request.headers.get("oai-authenticated-user-email") ??
    "Authenticated operator"
  );
}

async function definition(id: string) {
  return getD1()
    .prepare(
      `SELECT id, job_name AS jobName, description, comment, pre_validation AS preValidation,
            post_validation AS postValidation, pre_instructions AS preInstructions,
            post_instructions AS postInstructions, raw_json AS rawJson
     FROM job_definitions WHERE id = ? AND active = 1 AND definition_kind = 'VALIDATION'`,
    )
    .bind(id)
    .first();
}

export async function GET(_request: Request, context: Context) {
  try {
    await ensureDatabaseSchema();
    const item = await definition((await context.params).id);
    if (!item)
      return Response.json(
        { error: "The active validation definition was not found." },
        { status: 404 },
      );
    const raw = JSON.parse(
      String((item as { rawJson?: string }).rawJson || "{}"),
    ) as Record<string, unknown>;
    return Response.json({
      validation: {
        ...item,
        preMongoValidation: String(raw.preMongoValidation || ""),
        postMongoValidation: String(raw.postMongoValidation || ""),
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the validation query.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    await ensureDatabaseSchema();
    const id = (await context.params).id;
    const payload = (await request.json()) as {
      phase?: string;
      query?: string;
      queryType?: "SQL" | "MONGO";
    };
    if (payload.phase !== "PRE" && payload.phase !== "POST")
      return Response.json({ error: "Choose PRE or POST." }, { status: 400 });
    if (typeof payload.query !== "string" || payload.query.length > 50_000)
      return Response.json(
        { error: "Enter a query no longer than 50 KB." },
        { status: 400 },
      );
    const queryType = payload.queryType === "MONGO" ? "MONGO" : "SQL";
    const safety =
      queryType === "SQL"
        ? checkReadOnlySql(payload.query)
        : {
            safe: !/\b(insert|update|delete|remove|drop|create|rename|bulkWrite|replaceOne|replaceMany|findOneAndUpdate|findOneAndDelete|\$out|\$merge)\b/i.test(
              payload.query,
            ),
            message: "MongoDB query must be read-only.",
          };
    if (!safety.safe)
      return Response.json({ error: safety.message }, { status: 400 });
    const existing = await definition(id);
    if (!existing)
      return Response.json(
        { error: "The active validation definition was not found." },
        { status: 404 },
      );
    if (queryType === "SQL") {
      const field =
        payload.phase === "PRE" ? "pre_validation" : "post_validation";
      await getD1()
        .prepare(`UPDATE job_definitions SET ${field} = ? WHERE id = ?`)
        .bind(payload.query.trim(), id)
        .run();
    } else {
      const raw = JSON.parse(
        String((existing as { rawJson?: string }).rawJson || "{}"),
      ) as Record<string, unknown>;
      raw[
        payload.phase === "PRE" ? "preMongoValidation" : "postMongoValidation"
      ] = payload.query.trim();
      await getD1()
        .prepare("UPDATE job_definitions SET raw_json = ? WHERE id = ?")
        .bind(JSON.stringify(raw), id)
        .run();
    }
    await getD1()
      .prepare(
        `INSERT INTO integration_audit_events
       (id, event_type, actor_id, environment, integration, target_id, result, correlation_id, detail_json)
       VALUES (?, 'VALIDATION_QUERY_UPDATED', ?, 'LOCAL', 'validation-configuration', ?, 'SUCCEEDED', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actor(request),
        id,
        `query_${crypto.randomUUID()}`,
        JSON.stringify({ phase: payload.phase, queryType }),
      )
      .run();
    return Response.json({
      ok: true,
      message: `${payload.phase} ${queryType === "MONGO" ? "MongoDB" : "SQL"} query saved.`,
      readOnlyCheck: safety.message,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save the validation query.",
      },
      { status: 500 },
    );
  }
}
