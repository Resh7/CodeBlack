import {
  connectorAuthHeaders,
  connectorHttpsUrl,
  getEnvironmentIntegration,
  recordIntegrationAudit,
} from "@/lib/integrations";

function currentUser(request: Request) {
  return (
    request.headers.get("oai-authenticated-user-email") ??
    "Authenticated operator"
  );
}

function firstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function findCollection(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value))
    return value.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    );
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of [
    "items",
    "results",
    "data",
    "jobs",
    "content",
    "records",
  ]) {
    const candidate = record[key];
    if (Array.isArray(candidate))
      return candidate.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      );
    if (candidate && typeof candidate === "object") {
      const nested = findCollection(candidate);
      if (nested) return nested;
    }
  }
  return null;
}

function normalizeJob(raw: Record<string, unknown>) {
  return {
    id: String(
      firstValue(raw, ["id", "jobId", "job_id", "jobRunId", "uniqueId"]) ?? "",
    ),
    name: String(
      firstValue(raw, [
        "name",
        "jobName",
        "job_name",
        "definitionName",
        "description",
      ]) ?? "Unnamed job",
    ),
    definition: firstValue(raw, [
      "definition",
      "jobDefinition",
      "definitionName",
      "jobDefinitionName",
    ]),
    status: firstValue(raw, [
      "status",
      "state",
      "jobStatus",
      "executionStatus",
    ]),
    requestedAt: firstValue(raw, [
      "requestedAt",
      "submittedAt",
      "submitTime",
      "createdAt",
    ]),
    startedAt: firstValue(raw, [
      "startedAt",
      "startTime",
      "startDate",
      "actualStartTime",
    ]),
    endedAt: firstValue(raw, [
      "endedAt",
      "endTime",
      "endDate",
      "actualEndTime",
    ]),
    returnCode: firstValue(raw, ["returnCode", "exitCode", "resultCode"]),
    queue: firstValue(raw, ["queue", "queueName"]),
    server: firstValue(raw, ["server", "serverName", "jobServer"]),
    parentId: firstValue(raw, ["parentId", "parentJobId", "chainId"]),
  };
}

export async function GET(request: Request) {
  const correlationId = `rmj_${crypto.randomUUID()}`;
  const started = Date.now();
  try {
    const requested = new URL(request.url).searchParams;
    const environment = requested.get("environment")?.trim() || "LOCAL";
    const connection = await getEnvironmentIntegration(
      "RUNMYJOBS",
      environment,
    );
    if (!connection || !connection.enabled) {
      return Response.json(
        { error: "RunMyJobs is disabled in Settings.", correlationId },
        { status: 409 },
      );
    }
    const jobsPath = String(connection.nonSecretConfig.jobsPath || "").trim();
    if (!jobsPath) {
      return Response.json(
        {
          error:
            "Configure the Swagger-verified Jobs collection path in Settings before loading scheduler data.",
          correlationId,
        },
        { status: 409 },
      );
    }
    const base = String(connection.nonSecretConfig.restBaseUrl || "").replace(
      /\/$/,
      "",
    );
    const upstream = connectorHttpsUrl(
      `${base}/${jobsPath.replace(/^\//, "")}`,
      ".runmyjobs.cloud",
    );
    const businessDate = requested.get("businessDate")?.trim() ?? "";
    const dateParameter = String(
      connection.nonSecretConfig.jobsDateParameter || "",
    ).trim();
    if (businessDate && !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      return Response.json(
        { error: "Business date must use YYYY-MM-DD.", correlationId },
        { status: 400 },
      );
    }
    if (businessDate && !dateParameter) {
      return Response.json(
        {
          error:
            "Configure the Swagger-confirmed business-date parameter in RunMyJobs Settings before requesting past or future jobs.",
          correlationId,
        },
        { status: 409 },
      );
    }
    const mappings: [string, string][] = [
      [
        "businessDate",
        String(connection.nonSecretConfig.jobsDateParameter || ""),
      ],
      ["status", String(connection.nonSecretConfig.jobsStatusParameter || "")],
      ["q", String(connection.nonSecretConfig.jobsSearchParameter || "")],
    ];
    for (const [localName, upstreamName] of mappings) {
      const value = requested.get(localName)?.trim();
      if (value && upstreamName)
        upstream.searchParams.set(upstreamName, value.slice(0, 180));
    }
    const response = await fetch(upstream, {
      headers: {
        Accept: "application/json",
        ...connectorAuthHeaders(connection),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    if (body.length > 2_000_000)
      throw new Error("RunMyJobs response exceeded the 2 MB safety limit.");
    const payload = body ? (JSON.parse(body) as unknown) : {};
    if (!response.ok) {
      return Response.json(
        {
          error: `RunMyJobs jobs endpoint returned HTTP ${response.status}.`,
          correlationId,
        },
        { status: 502 },
      );
    }
    const collection = findCollection(payload);
    if (!collection) {
      const keys =
        payload && typeof payload === "object"
          ? Object.keys(payload as Record<string, unknown>).slice(0, 12)
          : [];
      return Response.json(
        {
          error:
            "The configured endpoint responded, but its job collection could not be recognized.",
          responseKeys: keys,
          correlationId,
        },
        { status: 502 },
      );
    }
    let jobs = collection.map(normalizeJob);
    const localSearch = requested.get("q")?.trim().toLowerCase();
    if (localSearch && !connection.nonSecretConfig.jobsSearchParameter)
      jobs = jobs.filter((job) => job.name.toLowerCase().includes(localSearch));
    const localStatus = requested.get("status")?.trim().toLowerCase();
    if (localStatus && !connection.nonSecretConfig.jobsStatusParameter)
      jobs = jobs.filter(
        (job) => String(job.status ?? "").toLowerCase() === localStatus,
      );
    await recordIntegrationAudit({
      eventType: "RUNMYJOBS_JOBS_READ",
      actorId: currentUser(request),
      environment: connection.environment,
      integration: connection.type,
      targetId: connection.id,
      result: "SUCCEEDED",
      durationMs: Date.now() - started,
      rowCount: jobs.length,
      correlationId,
      detail: { businessDate: requested.get("businessDate") ?? null },
    }).catch(() => undefined);
    return Response.json({
      jobs,
      source: "RUNMYJOBS",
      appliedFilters: {
        businessDate: Boolean(businessDate && dateParameter),
        status: Boolean(
          requested.get("status") &&
            connection.nonSecretConfig.jobsStatusParameter,
        ),
        search: Boolean(
          requested.get("q") && connection.nonSecretConfig.jobsSearchParameter,
        ),
      },
      correlationId,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load RunMyJobs data.",
        correlationId,
      },
      { status: 500 },
    );
  }
}
