import { getD1 } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";
import {
  connectorAuthHeaders,
  connectorHttpsUrl,
  getEnvironmentIntegration,
  recordIntegrationAudit,
} from "@/lib/integrations";
import { checkReadOnlySql } from "@/lib/sql-query-tools";

type ValidationRequest = {
  environment?: string;
  jobId?: string;
  phase?: "PRE" | "POST";
  businessDate?: string;
  parameters?: Record<string, string | number | boolean>;
};

type Definition = {
  id: string;
  jobName: string;
  preValidation: string;
  postValidation: string;
  rawJson: string;
};

const MAX_GATEWAY_RESPONSE_BYTES = 2 * 1024 * 1024;
const SAFE_PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;

function currentUser(request: Request) {
  return (
    request.headers.get("oai-authenticated-user-email") ??
    "Authenticated operator"
  );
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sourceHint(rawJson: string) {
  try {
    const raw = JSON.parse(rawJson) as Record<string, unknown>;
    const value = Object.entries(raw).find(([key]) =>
      ["datasource", "database", "sourcetype", "connection"].includes(
        normalizedKey(key),
      ),
    )?.[1];
    return String(value ?? "").toLowerCase();
  } catch {
    return "";
  }
}

function validateRequestPayload(payload: ValidationRequest) {
  if (
    !payload.jobId ||
    payload.jobId.length > 200 ||
    !payload.phase ||
    !["PRE", "POST"].includes(payload.phase)
  ) {
    throw new Error("A valid Job ID and PRE or POST phase are required.");
  }
  if (
    payload.businessDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.businessDate)
  ) {
    throw new Error("Business date must use YYYY-MM-DD format.");
  }
  const entries = Object.entries(payload.parameters ?? {});
  if (entries.length > 25)
    throw new Error("A maximum of 25 validation parameters is allowed.");
  for (const [key, value] of entries) {
    if (!SAFE_PARAMETER_NAME.test(key))
      throw new Error(`Validation parameter name '${key}' is not allowed.`);
    if (!["string", "number", "boolean"].includes(typeof value))
      throw new Error(
        `Validation parameter '${key}' has an unsupported value.`,
      );
    if (typeof value === "string" && value.length > 1_000)
      throw new Error(
        `Validation parameter '${key}' exceeds 1,000 characters.`,
      );
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error(`Validation parameter '${key}' must be finite.`);
  }
}

function rejectMongoWriteOperators(value: unknown) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(rejectMongoWriteOperators);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      ["$out", "$merge", "$where", "$function", "$accumulator"].includes(
        key.toLowerCase(),
      )
    ) {
      throw new Error(
        `MongoDB operator '${key}' is not allowed in read-only validations.`,
      );
    }
    rejectMongoWriteOperators(child);
  }
}

function validateReadOnlyQuery(query: string, mongo: boolean) {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("The imported validation query is empty.");
  if (trimmed.length > 50_000)
    throw new Error(
      "The imported validation query exceeds the 50 KB safety limit.",
    );
  if (mongo) {
    if (!trimmed.startsWith("{") && !trimmed.startsWith("["))
      throw new Error(
        "MongoDB validations must be an imported JSON filter or aggregation pipeline.",
      );
    rejectMongoWriteOperators(JSON.parse(trimmed));
    return;
  }
  const safety = checkReadOnlySql(trimmed);
  if (!safety.safe) throw new Error(safety.message);
}

async function recordRun(
  request: Request,
  definition: Definition,
  phase: "PRE" | "POST",
  status: string,
  message: string,
  resultCount: number | null,
  durationMs: number,
  correlationId: string,
) {
  const id = crypto.randomUUID();
  await getD1()
    .prepare(
      `INSERT INTO validation_runs
      (id, job_id, job_name, phase, status, result_count, message, duration_ms, correlation_id, executed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      definition.id,
      definition.jobName,
      phase,
      status,
      resultCount,
      message,
      durationMs,
      correlationId,
      currentUser(request),
    )
    .run();
  return id;
}

export async function POST(request: Request) {
  const started = Date.now();
  const correlationId = `validation_${crypto.randomUUID()}`;
  try {
    await ensureDatabaseSchema();
    const payload = (await request.json()) as ValidationRequest;
    try {
      validateRequestPayload(payload);
    } catch (validationError) {
      return Response.json(
        {
          error:
            validationError instanceof Error
              ? validationError.message
              : "Invalid validation request.",
          correlationId,
        },
        { status: 400 },
      );
    }
    const jobId = payload.jobId as string;
    const phase = payload.phase as "PRE" | "POST";
    const definition = await getD1()
      .prepare(
        `SELECT id, job_name AS jobName, pre_validation AS preValidation,
              post_validation AS postValidation, raw_json AS rawJson
       FROM job_definitions
       WHERE id = ? AND active = 1 AND definition_kind = 'VALIDATION'`,
      )
      .bind(jobId)
      .first<Definition>();
    if (!definition)
      return Response.json(
        {
          error: "The active imported validation definition was not found.",
          correlationId,
        },
        { status: 404 },
      );
    const query =
      phase === "PRE" ? definition.preValidation : definition.postValidation;
    const hint = sourceHint(definition.rawJson);
    const isMongo =
      hint.includes("mongo") ||
      query.trim().startsWith("{") ||
      query.trim().startsWith("[");
    validateReadOnlyQuery(query, isMongo);
    const connection = await getEnvironmentIntegration(
      isMongo ? "MONGODB" : "ORACLE",
      payload.environment?.trim() || "LOCAL",
    );
    if (!connection || !connection.enabled) {
      const message = `${isMongo ? "MongoDB" : "Oracle"} validation connector is disabled in Settings.`;
      const runId = await recordRun(
        request,
        definition,
        phase,
        "CONFIGURATION_REQUIRED",
        message,
        null,
        Date.now() - started,
        correlationId,
      );
      return Response.json(
        { runId, status: "CONFIGURATION_REQUIRED", message, correlationId },
        { status: 409 },
      );
    }
    const gatewayValue = String(
      connection.nonSecretConfig.gatewayUrl || "",
    ).trim();
    if (!gatewayValue) {
      const message = `Configure the approved ${connection.displayName} HTTPS gateway in Settings before executing validations.`;
      const runId = await recordRun(
        request,
        definition,
        phase,
        "CONFIGURATION_REQUIRED",
        message,
        null,
        Date.now() - started,
        correlationId,
      );
      return Response.json(
        { runId, status: "CONFIGURATION_REQUIRED", message, correlationId },
        { status: 409 },
      );
    }
    const gatewayUrl = connectorHttpsUrl(gatewayValue);
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...connectorAuthHeaders(connection),
      },
      body: JSON.stringify({
        operation: isMongo
          ? "mongodb_read_validation"
          : "oracle_read_validation",
        queryTemplate: query,
        parameters: payload.parameters ?? {},
        businessDate: payload.businessDate,
        jobId: definition.id,
        jobName: definition.jobName,
        phase,
        readOnly: true,
        maximumRows: Number(connection.nonSecretConfig.maximumRows || 1000),
      }),
      signal: AbortSignal.timeout(
        Math.min(
          Math.max(
            Number(connection.nonSecretConfig.timeoutSeconds || 30) * 1000,
            1_000,
          ),
          120_000,
        ),
      ),
    });
    const responseText = await response.text();
    if (
      new TextEncoder().encode(responseText).byteLength >
      MAX_GATEWAY_RESPONSE_BYTES
    ) {
      throw new Error(
        `${connection.displayName} gateway response exceeded the 2 MB safety limit.`,
      );
    }
    let result: {
      count?: number;
      rowCount?: number;
      message?: string;
      status?: string;
    } = {};
    if (responseText) {
      try {
        result = JSON.parse(responseText) as typeof result;
      } catch {
        throw new Error(
          `${connection.displayName} gateway returned a non-JSON response.`,
        );
      }
    }
    const status = response.ok ? String(result.status || "SUCCESS") : "FAILED";
    const message =
      result.message ??
      `${connection.displayName} gateway returned HTTP ${response.status}.`;
    const resultCount =
      typeof result.count === "number"
        ? result.count
        : typeof result.rowCount === "number"
          ? result.rowCount
          : null;
    const durationMs = Date.now() - started;
    const runId = await recordRun(
      request,
      definition,
      phase,
      status,
      message,
      resultCount,
      durationMs,
      correlationId,
    );
    await recordIntegrationAudit({
      eventType: "VALIDATION_EXECUTED",
      actorId: currentUser(request),
      environment: connection.environment,
      integration: connection.type,
      targetId: definition.id,
      result: response.ok ? "SUCCEEDED" : "FAILED",
      durationMs,
      rowCount: resultCount ?? undefined,
      correlationId,
      detail: { phase, businessDate: payload.businessDate ?? null },
    }).catch(() => undefined);
    return Response.json(
      { runId, status, message, resultCount, durationMs, correlationId },
      { status: response.ok ? 200 : 502 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Validation execution failed.",
        correlationId,
      },
      { status: 500 },
    );
  }
}
