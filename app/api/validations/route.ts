import { getD1 } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function raw(value: unknown) {
  try {
    return JSON.parse(String(value || "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function field(record: Record<string, unknown>, names: string[]) {
  const item = Object.entries(record).find(([key]) =>
    names.includes(normalizedKey(key)),
  );
  return item?.[1] == null ? "" : String(item[1]).trim();
}

function dateMatches(value: string, businessDate: string) {
  if (!businessDate) return false;
  const date = new Date(`${businessDate}T12:00:00`);
  const weekday = date.getDay();
  const normalized = normalizedKey(value);
  if (
    ["weekworkingdays", "workingdays", "weekdays", "mondayfriday"].includes(
      normalized,
    )
  )
    return weekday >= 1 && weekday <= 5;
  if (["daily", "everyday", "alldays"].includes(normalized)) return true;
  const candidates = [
    businessDate,
    businessDate.slice(2),
    `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`,
    `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`,
  ];
  return candidates.some(
    (candidate) => value.trim().toLowerCase() === candidate.toLowerCase(),
  );
}

function normalizedJobName(value: string) {
  return normalizedKey(value)
    .replace(/^(batch|job|process|chain)/, "")
    .replace(/(job|process|chain)$/, "");
}

function namesMatch(left: string, right: string) {
  const leftKey = normalizedJobName(left);
  const rightKey = normalizedJobName(right);
  if (!leftKey || !rightKey) return false;
  return (
    leftKey === rightKey ||
    (Math.min(leftKey.length, rightKey.length) >= 8 &&
      (leftKey.includes(rightKey) || rightKey.includes(leftKey)))
  );
}

export async function GET(request: Request) {
  try {
    await ensureDatabaseSchema();
    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.trim().toLowerCase() ?? "";
    const businessDate = params.get("businessDate")?.trim() ?? "";
    const db = getD1();
    const definitions = await db
      .prepare(
        `SELECT id, job_name AS jobName, description, comment, pre_validation AS preValidation,
              post_validation AS postValidation, pre_instructions AS preInstructions,
              post_instructions AS postInstructions, raw_json AS rawJson,
              definition_kind AS definitionKind, source_import_id AS sourceImportId
       FROM job_definitions WHERE active = 1 ORDER BY created_at, job_name LIMIT 5000`,
      )
      .all<Record<string, unknown>>();
    const runs = await db
      .prepare(
        `SELECT id, job_id AS jobId, phase, query_type AS queryType, status, result_count AS resultCount,
              message, duration_ms AS durationMs, correlation_id AS correlationId,
              executed_at AS executedAt FROM validation_runs ORDER BY executed_at DESC`,
      )
      .all<Record<string, unknown>>();

    const latestRun = new Map<string, Record<string, unknown>>();
    const latestPhaseRun = new Map<string, Record<string, unknown>>();
    for (const run of runs.results) {
      const jobId = String(run.jobId || "");
      const phase = String(run.phase || "");
      if (!latestRun.has(jobId)) latestRun.set(jobId, run);
      const queryType = String(run.queryType || "SQL");
      if (!latestPhaseRun.has(`${jobId}:${phase}:${queryType}`))
        latestPhaseRun.set(`${jobId}:${phase}:${queryType}`, run);
    }
    const scheduledJobs = definitions.results
      .filter((item) =>
        ["DAILY", "SPECIAL"].includes(String(item.definitionKind)),
      )
      .map((schedule) => {
        const source = raw(schedule.rawJson);
        const jobName =
          field(source, ["rmjjobname", "rmjjobnames", "rmjname"]) ||
          String(schedule.jobName || "");
        const aliases = [
          jobName,
          String(schedule.jobName || ""),
          field(source, ["rmjjobname", "rmjjobnames", "rmjname"]),
          field(source, ["jobname", "job", "processname", "definitionname"]),
        ].filter(Boolean);
        const scheduleGroup =
          field(source, [
            "schedulegroup",
            "schedule",
            "time",
            "starttime",
            "runtime",
          ]) || "Unscheduled";
        return {
          aliases,
          scheduleGroup,
          isDue: dateMatches(
            field(source, ["date", "frequency", "rundate"]),
            businessDate,
          ),
        };
      });
    const validations = definitions.results
      .filter((definition) => definition.definitionKind === "VALIDATION")
      .map((definition) => {
        const id = String(definition.id || "");
        if (!id) return null;
        const source = raw(definition.rawJson);
        const jobName =
          field(source, ["rmjjobname", "rmjjobnames", "rmjname", "jobname"]) ||
          String(definition.jobName || "");
        const validationAliases = [
          jobName,
          String(definition.jobName || ""),
          field(source, ["rmjjobname", "rmjjobnames", "rmjname"]),
          field(source, ["jobname", "job", "processname", "definitionname"]),
        ].filter(Boolean);
        const matchingSchedules = scheduledJobs.filter((schedule) =>
          validationAliases.some((validationName) =>
            schedule.aliases.some((scheduledName) =>
              namesMatch(validationName, scheduledName),
            ),
          ),
        );
        const matchedSchedule =
          matchingSchedules.find((schedule) => schedule.isDue) ||
          matchingSchedules[0];
        const latest = latestRun.get(id);
        const preSql = latestPhaseRun.get(`${id}:PRE:SQL`);
        const preMongo = latestPhaseRun.get(`${id}:PRE:MONGO`);
        const postSql = latestPhaseRun.get(`${id}:POST:SQL`);
        const postMongo = latestPhaseRun.get(`${id}:POST:MONGO`);
        const preTotal = [preSql, preMongo].reduce(
          (total, run) => total + Number(run?.resultCount ?? 0),
          0,
        );
        const postTotal = [postSql, postMongo].reduce(
          (total, run) => total + Number(run?.resultCount ?? 0),
          0,
        );
        return {
          id,
          jobName,
          scheduleGroup: matchedSchedule?.scheduleGroup || "Unscheduled",
          isScheduled: Boolean(matchedSchedule?.isDue),
          description: definition.description,
          comment: definition.comment,
          hasPreValidation: Boolean(definition.preValidation),
          hasPostValidation: Boolean(definition.postValidation),
          hasPreMongoValidation: Boolean(source.preMongoValidation),
          hasPostMongoValidation: Boolean(source.postMongoValidation),
          preValidation: definition.preValidation ? "AVAILABLE" : "",
          postValidation: definition.postValidation ? "AVAILABLE" : "",
          preInstructions: definition.preInstructions,
          postInstructions: definition.postInstructions,
          sourceImportId: definition.sourceImportId,
          lastRunId: latest?.id,
          lastPhase: latest?.phase,
          lastStatus: latest?.status || "NOT_REPORTED",
          lastResultCount: latest?.resultCount,
          lastMessage: latest?.message,
          lastDurationMs: latest?.durationMs,
          lastCorrelationId: latest?.correlationId,
          lastExecutedAt: latest?.executedAt,
          preSqlResultCount: preSql?.resultCount ?? null,
          preMongoResultCount: preMongo?.resultCount ?? null,
          postSqlResultCount: postSql?.resultCount ?? null,
          postMongoResultCount: postMongo?.resultCount ?? null,
          preResultCount: preSql || preMongo ? preTotal : null,
          preResultStatus: preSql?.status ?? preMongo?.status ?? "NOT_REPORTED",
          postResultCount: postSql || postMongo ? postTotal : null,
          postResultStatus:
            postSql?.status ?? postMongo?.status ?? "NOT_REPORTED",
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter(
        (item) =>
          !query ||
          `${item.jobName} ${item.description || ""} ${item.comment || ""}`
            .toLowerCase()
            .includes(query),
      )
      .sort((a, b) => {
        if (a.isScheduled !== b.isScheduled) return a.isScheduled ? -1 : 1;
        return a.jobName.localeCompare(b.jobName);
      });
    return Response.json({
      validations,
      source: "IMPORTED_VALIDATION_CONFIGURATION_GROUPED_BY_SCHEDULE",
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load validation definitions.",
      },
      { status: 500 },
    );
  }
}
