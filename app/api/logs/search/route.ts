import {
  APPROVED_MICROSERVICES,
  APPROVED_NAMESPACES,
  getGcpAccessToken,
  getEnvironmentIntegration,
  recordIntegrationAudit,
} from "@/lib/integrations";

type SearchRequest = {
  environment?: string;
  projectId?: string;
  namespace?: string;
  microservice?: string;
  from?: string;
  to?: string;
  severity?: string;
  message?: string;
  jobId?: string;
  traceId?: string;
  sessionId?: string;
  pageToken?: string;
  pageSize?: number;
};

function currentUser(request: Request) {
  return (
    request.headers.get("oai-authenticated-user-email") ??
    "Authenticated operator"
  );
}

function quoted(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function validDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: Request) {
  const correlationId = `logs_${crypto.randomUUID()}`;
  const started = Date.now();
  try {
    const input = (await request.json()) as SearchRequest;
    const connector = await getEnvironmentIntegration(
      "GCP_LOGGING",
      input.environment?.trim() || "LOCAL",
    );
    if (!connector?.enabled)
      return Response.json(
        {
          error: "Cloud Logging is disabled in Integration Settings.",
          category: "CONFIGURATION",
          correlationId,
        },
        { status: 409 },
      );
    const projectId =
      input.projectId ??
      String(connector.nonSecretConfig.projectId || "bes-np");
    if (projectId !== String(connector.nonSecretConfig.projectId || "")) {
      return Response.json(
        {
          error:
            "The selected project does not match the configured Logging connector.",
          correlationId,
        },
        { status: 400 },
      );
    }
    const approvedNamespaces =
      APPROVED_NAMESPACES[projectId as keyof typeof APPROVED_NAMESPACES];
    const configuredNamespaces = String(
      connector.nonSecretConfig.namespaces || "",
    )
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const configuredServices = String(
      connector.nonSecretConfig.microservices || "",
    )
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (
      !approvedNamespaces ||
      !input.namespace ||
      !(approvedNamespaces as readonly string[]).includes(input.namespace) ||
      !configuredNamespaces.includes(input.namespace)
    ) {
      return Response.json(
        {
          error: "Select a namespace enabled in the Logging connector.",
          correlationId,
        },
        { status: 400 },
      );
    }
    if (
      !input.microservice ||
      !(APPROVED_MICROSERVICES as readonly string[]).includes(
        input.microservice,
      ) ||
      !configuredServices.includes(input.microservice)
    ) {
      return Response.json(
        {
          error: "Select a microservice enabled in the Logging connector.",
          correlationId,
        },
        { status: 400 },
      );
    }
    const to = validDate(input.to) ?? new Date();
    const from = validDate(input.from) ?? new Date(to.getTime() - 15 * 60_000);
    if (from >= to)
      return Response.json(
        {
          error: "The start time must be earlier than the end time.",
          correlationId,
        },
        { status: 400 },
      );
    if (to.getTime() - from.getTime() > 24 * 60 * 60_000) {
      return Response.json(
        {
          error: "The proof-of-concept search window is limited to 24 hours.",
          correlationId,
        },
        { status: 400 },
      );
    }
    const filters = [
      `resource.type=${quoted(String(connector.nonSecretConfig.resourceType || "k8s_container"))}`,
      `resource.labels.namespace_name=${quoted(input.namespace)}`,
      `labels.${quoted("k8s-pod/app")}=${quoted(input.microservice)}`,
      `timestamp>=${quoted(from.toISOString())}`,
      `timestamp<=${quoted(to.toISOString())}`,
    ];
    if (input.severity && input.severity !== "ALL")
      filters.push(`severity>=${input.severity}`);
    if (input.message?.trim())
      filters.push(
        `(textPayload:${quoted(input.message.trim())} OR jsonPayload.message:${quoted(input.message.trim())})`,
      );
    if (input.jobId?.trim())
      filters.push(`jsonPayload.jobId=${quoted(input.jobId.trim())}`);
    if (input.traceId?.trim())
      filters.push(`trace:${quoted(input.traceId.trim())}`);
    if (input.sessionId?.trim())
      filters.push(`jsonPayload.sessionId=${quoted(input.sessionId.trim())}`);

    const token = await getGcpAccessToken(connector);
    const response = await fetch(
      "https://logging.googleapis.com/v2/entries:list",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resourceNames: [`projects/${projectId}`],
          filter: filters.join(" AND "),
          orderBy: "timestamp desc",
          pageSize: Math.min(Math.max(Number(input.pageSize) || 100, 1), 100),
          ...(input.pageToken ? { pageToken: input.pageToken } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const result = (await response.json().catch(() => ({}))) as {
      entries?: Array<Record<string, unknown>>;
      nextPageToken?: string;
      error?: { message?: string };
    };
    const durationMs = Date.now() - started;
    if (!response.ok) {
      const category =
        response.status === 401
          ? "AUTHENTICATION"
          : response.status === 403
            ? "AUTHORIZATION"
            : response.status === 429
              ? "RATE_LIMIT"
              : "UPSTREAM";
      await recordIntegrationAudit({
        eventType: "LOG_SEARCHED",
        actorId: currentUser(request),
        environment: connector.environment,
        integration: "GCP_LOGGING",
        targetId: connector.id,
        result: "FAILED",
        durationMs,
        correlationId,
        detail: { category, status: response.status },
      }).catch(() => undefined);
      return Response.json(
        {
          error:
            result.error?.message ||
            `Cloud Logging returned HTTP ${response.status}.`,
          category,
          correlationId,
        },
        { status: response.status === 403 ? 403 : 502 },
      );
    }
    const entries = (result.entries ?? []).map((entry) => {
      const resource = (entry.resource ?? {}) as {
        type?: string;
        labels?: Record<string, string>;
      };
      const labels = (entry.labels ?? {}) as Record<string, string>;
      const jsonPayload = (entry.jsonPayload ?? {}) as Record<string, unknown>;
      const message =
        typeof entry.textPayload === "string"
          ? entry.textPayload
          : typeof jsonPayload.message === "string"
            ? jsonPayload.message
            : JSON.stringify(jsonPayload);
      return {
        timestamp: entry.timestamp,
        severity: entry.severity ?? "DEFAULT",
        projectId,
        namespace: resource.labels?.namespace_name ?? input.namespace,
        microservice: labels["k8s-pod/app"] ?? input.microservice,
        pod: resource.labels?.pod_name ?? "",
        container: resource.labels?.container_name ?? "",
        message,
        trace: entry.trace ?? "",
        spanId: entry.spanId ?? "",
        logName: entry.logName ?? "",
        insertId: entry.insertId ?? "",
        jsonPayload,
      };
    });
    await recordIntegrationAudit({
      eventType: "LOG_SEARCHED",
      actorId: currentUser(request),
      environment: connector.environment,
      integration: "GCP_LOGGING",
      targetId: connector.id,
      result: "SUCCEEDED",
      durationMs,
      rowCount: entries.length,
      correlationId,
      detail: { namespace: input.namespace, microservice: input.microservice },
    }).catch(() => undefined);
    return Response.json({
      entries,
      nextPageToken: result.nextPageToken ?? null,
      durationMs,
      correlationId,
      truncated: Boolean(result.nextPageToken),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Cloud Logging search failed.",
        category: "UPSTREAM",
        correlationId,
      },
      { status: 500 },
    );
  }
}
