import { env } from "cloudflare:workers";

import { getD1 } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";
import { ENVIRONMENTS } from "@/lib/environments";

export type IntegrationType =
  | "RUNMYJOBS"
  | "GCP_LOGGING"
  | "GCP_STORAGE"
  | "ORACLE"
  | "MONGODB";

export type IntegrationStatus =
  | "NOT_CONFIGURED"
  | "DISABLED"
  | "READY"
  | "TESTING"
  | "CONNECTED"
  | "DEGRADED"
  | "FAILED";

export type IntegrationConfig = Record<string, string | number | boolean>;

export type IntegrationConnection = {
  id: string;
  type: IntegrationType;
  displayName: string;
  environment: string;
  description: string;
  enabled: boolean;
  nonSecretConfig: IntegrationConfig;
  secretReference: string;
  status: IntegrationStatus;
  lastTestedAt?: string;
  lastLatencyMs?: number;
  capabilities: string[];
  lastErrorCategory?: string;
  lastDiagnostic?: string;
  lastCorrelationId?: string;
  configVersion: number;
  updatedBy: string;
  updatedAt: string;
};

export type RuntimeIntegration = IntegrationConnection & {
  secretConfigured: boolean;
  requiredFields: string[];
};

export type IntegrationLoadState = {
  integrations: RuntimeIntegration[];
  storageAvailable: boolean;
  storageWarning?: string;
};

export type TestResult = {
  status: "CONNECTED" | "DEGRADED" | "FAILED";
  checkedAt: string;
  latencyMs: number;
  capabilities: string[];
  errorCategory?: string;
  diagnostic: string;
  correlationId: string;
};

export const APPROVED_NAMESPACES = {
  "bes-np": ["dev1", "dev2", "int1", "sit1", "per1"],
  "bes-prod": ["tim3", "uat1"],
} as const;

export const APPROVED_MICROSERVICES = [
  "bes-api",
  "bes-batch",
  "bes-connector",
  "bes-core",
  "bes-cpd",
  "bes-ctm",
  "bes-db",
  "bes-fis",
  "bes-fmm",
  "bes-ids",
  "bes-int-cons",
  "bes-lib",
  "bes-model",
  "bes-mongodb",
  "bes-rms",
  "bes-sspmodel",
  "bes-tpm",
] as const;

export const APPROVED_GCS_PREFIXES = [
  "BatchControlReport/",
  "DEV1/",
  "DEV2/",
  "FNA/",
  "INBOUND/",
  "INT1/",
  "OUTBOUND/",
  "SIT1/",
  "TIM1/",
  "TRN1/",
] as const;

function slug(environment: string) {
  return environment.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
function tier(environment: string) {
  return (
    ENVIRONMENTS.find((item) => item.id === environment)?.tier ?? "Non-prod"
  );
}
function projectFor(environment: string) {
  return tier(environment) === "Prod" ? "bes-prod" : "bes-np";
}
function namespaceFor(environment: string) {
  return environment === "LOCAL"
    ? "dev1"
    : environment.replace(/^NP_|^PROD_/, "").toLowerCase();
}
function secretReference(type: IntegrationType, environment: string) {
  const family =
    type === "RUNMYJOBS"
      ? "RMJ"
      : type === "GCP_LOGGING" || type === "GCP_STORAGE"
        ? "GCP"
        : type;
  const suffix =
    type === "RUNMYJOBS"
      ? "API_TOKEN"
      : type === "GCP_LOGGING" || type === "GCP_STORAGE"
        ? "SERVICE_ACCOUNT_JSON"
        : "GATEWAY_TOKEN";
  return `${family}_${environment}_${suffix}`;
}

function defaultIntegration(
  type: IntegrationType,
  environment: string,
): IntegrationConnection {
  const project = projectFor(environment);
  const namespace = namespaceFor(environment);
  const base = {
    environment,
    enabled: true,
    status: "NOT_CONFIGURED" as const,
    capabilities: [],
    configVersion: 1,
    updatedBy: "System default",
    updatedAt: "",
  };
  if (type === "RUNMYJOBS")
    return {
      ...base,
      id: `rmj-${slug(environment)}`,
      type,
      displayName: "Redwood RunMyJobs",
      description:
        "Scheduler definitions, executions, chains, queues, and job-server health for this environment.",
      secretReference: secretReference(type, environment),
      nonSecretConfig: {
        consoleRoot: "https://oregon.runmyjobs.cloud/",
        company: "eworld-enterprise-solutions",
        tenantEnvironment: namespace,
        restBaseUrl: "",
        swaggerUrl: "",
        probePath: "",
        jobsPath: "",
        jobsDateParameter: "",
        jobsStatusParameter: "",
        jobsSearchParameter: "",
        authentication: "BEARER",
        apiKeyHeader: "X-API-Key",
        pollingSeconds: 60,
      },
    };
  if (type === "GCP_LOGGING")
    return {
      ...base,
      id: `gcp-logging-${slug(environment)}`,
      type,
      displayName: "Google Cloud Logging",
      description:
        "Historical and controlled live application logs for this environment.",
      secretReference: secretReference(type, environment),
      nonSecretConfig: {
        projectId: project,
        resourceType: "k8s_container",
        namespaces: (
          APPROVED_NAMESPACES[project as keyof typeof APPROVED_NAMESPACES] ?? [
            namespace,
          ]
        ).join(","),
        microservices: APPROVED_MICROSERVICES.join(","),
        retentionDays: "",
        livePollingSeconds: 5,
      },
    };
  if (type === "GCP_STORAGE")
    return {
      ...base,
      id: `gcs-${slug(environment)}`,
      type,
      displayName: "Google Cloud Storage",
      description:
        "Read-only folder browsing, metadata, preview, and audited download for this environment.",
      secretReference: secretReference(type, environment),
      nonSecretConfig: {
        projectId: project,
        bucket: "",
        basePath: "",
        approvedPrefixes: APPROVED_GCS_PREFIXES.join(","),
        maxScanCount: 1000,
        maxPreviewMb: 2,
        allowDownload: true,
      },
    };
  if (type === "ORACLE")
    return {
      ...base,
      id: `oracle-${slug(environment)}`,
      type,
      displayName: "Oracle SQL",
      description:
        "Approved read-only SQL through the private HTTPS gateway for this environment.",
      secretReference: secretReference(type, environment),
      nonSecretConfig: {
        host: "",
        port: 1521,
        serviceName: "",
        gatewayUrl: "",
        tlsMode: "TO_BE_CONFIRMED",
        approvedSchemas: "",
        maximumRows: 1000,
        timeoutSeconds: 10,
      },
    };
  return {
    ...base,
    id: `mongodb-${slug(environment)}`,
    type,
    displayName: "MongoDB Atlas",
    description:
      "Approved read-only MongoDB access through the private HTTPS gateway for this environment.",
    secretReference: secretReference(type, environment),
    nonSecretConfig: {
      clusterHost: "",
      database: "",
      gatewayUrl: "",
      approvedCollections: "",
      productionApproved: tier(environment) !== "Prod",
      maximumRows: 1000,
      timeoutSeconds: 10,
    },
  };
}

export const DEFAULT_INTEGRATIONS: IntegrationConnection[] =
  ENVIRONMENTS.flatMap((item) =>
    (
      [
        "RUNMYJOBS",
        "GCP_LOGGING",
        "GCP_STORAGE",
        "ORACLE",
        "MONGODB",
      ] as IntegrationType[]
    ).map((type) => defaultIntegration(type, item.id)),
  );

const REQUIRED_FIELDS: Record<IntegrationType, string[]> = {
  RUNMYJOBS: [
    "company",
    "tenantEnvironment",
    "restBaseUrl",
    "swaggerUrl",
    "authentication",
  ],
  GCP_LOGGING: ["projectId", "resourceType", "namespaces", "microservices"],
  GCP_STORAGE: ["projectId", "bucket", "approvedPrefixes"],
  ORACLE: ["host", "port", "serviceName", "gatewayUrl", "approvedSchemas"],
  MONGODB: [
    "clusterHost",
    "database",
    "gatewayUrl",
    "approvedCollections",
    "productionApproved",
  ],
};

class ConnectorError extends Error {
  category: string;
  constructor(category: string, message: string) {
    super(message);
    this.category = category;
  }
}

function runtimeEnv() {
  return env as unknown as Record<string, unknown>;
}

function secretNames(_id: string, connection?: IntegrationConnection) {
  if (!connection) return [];
  if (connection.type === "RUNMYJOBS") {
    const family = `RMJ_${connection.environment}`;
    return String(connection.nonSecretConfig.authentication || "BEARER") ===
      "BASIC"
      ? [`${family}_BASIC_CREDENTIALS`]
      : [`${family}_API_TOKEN`];
  }
  if (connection.type === "GCP_LOGGING" || connection.type === "GCP_STORAGE") {
    const family = `GCP_${connection.environment}`;
    return [`${family}_SERVICE_ACCOUNT_JSON`, `${family}_ACCESS_TOKEN`];
  }
  return [`${connection.type}_${connection.environment}_GATEWAY_TOKEN`];
}

export function secretConfigured(
  id: string,
  connection?: IntegrationConnection,
) {
  return secretNames(id, connection).some(
    (name) =>
      typeof runtimeEnv()[name] === "string" &&
      String(runtimeEnv()[name]).length > 0,
  );
}

function runtimeSecret(id: string, connection?: IntegrationConnection) {
  for (const name of secretNames(id, connection)) {
    const value = runtimeEnv()[name];
    if (typeof value === "string" && value) return { name, value };
  }
  return null;
}

export function requiredFields(id: string) {
  const connection = DEFAULT_INTEGRATIONS.find((item) => item.id === id);
  return connection ? REQUIRED_FIELDS[connection.type] : [];
}

export function missingRequiredFields(connection: IntegrationConnection) {
  return requiredFields(connection.id).filter((field) => {
    const value = connection.nonSecretConfig[field];
    return value === "" || value == null || value === false;
  });
}

function parseJson<T>(value: string, fallback: T) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mergeIntegrations(
  stored: Map<string, Partial<IntegrationConnection>>,
) {
  return DEFAULT_INTEGRATIONS.map((base): RuntimeIntegration => {
    const saved = stored.get(base.id);
    const merged = saved
      ? {
          ...base,
          ...saved,
          nonSecretConfig: {
            ...base.nonSecretConfig,
            ...(saved.nonSecretConfig ?? {}),
          },
        }
      : { ...base };
    if (!merged.enabled) merged.status = "DISABLED";
    else if (
      missingRequiredFields(merged).length ||
      !secretConfigured(merged.id, merged)
    ) {
      if (!["FAILED", "DEGRADED"].includes(merged.status))
        merged.status = "NOT_CONFIGURED";
    } else if (
      merged.status === "NOT_CONFIGURED" ||
      merged.status === "DISABLED"
    )
      merged.status = "READY";
    return {
      ...merged,
      secretConfigured: secretConfigured(merged.id, merged),
      requiredFields: requiredFields(merged.id),
    };
  });
}

export async function loadIntegrationState(): Promise<IntegrationLoadState> {
  await ensureDatabaseSchema();
  const stored = new Map<string, Partial<IntegrationConnection>>();
  try {
    const rows = await getD1()
      .prepare(
        `SELECT id, type, display_name AS displayName, environment, description, enabled,
              non_secret_config_json AS nonSecretConfigJson, secret_reference AS secretReference,
              status, last_tested_at AS lastTestedAt, last_latency_ms AS lastLatencyMs,
              capabilities_json AS capabilitiesJson, last_error_category AS lastErrorCategory,
              last_diagnostic AS lastDiagnostic, last_correlation_id AS lastCorrelationId,
              config_version AS configVersion, updated_by AS updatedBy, updated_at AS updatedAt
       FROM integration_connections`,
      )
      .all<Record<string, unknown>>();
    for (const row of rows.results) {
      stored.set(String(row.id), {
        id: String(row.id),
        type: row.type as IntegrationType,
        displayName: String(row.displayName),
        environment: String(row.environment),
        description: String(row.description),
        enabled: Boolean(row.enabled),
        nonSecretConfig: parseJson(String(row.nonSecretConfigJson ?? "{}"), {}),
        secretReference: String(row.secretReference),
        status: row.status as IntegrationStatus,
        lastTestedAt: row.lastTestedAt ? String(row.lastTestedAt) : undefined,
        lastLatencyMs:
          row.lastLatencyMs == null ? undefined : Number(row.lastLatencyMs),
        capabilities: parseJson(String(row.capabilitiesJson ?? "[]"), []),
        lastErrorCategory: row.lastErrorCategory
          ? String(row.lastErrorCategory)
          : undefined,
        lastDiagnostic: row.lastDiagnostic
          ? String(row.lastDiagnostic)
          : undefined,
        lastCorrelationId: row.lastCorrelationId
          ? String(row.lastCorrelationId)
          : undefined,
        configVersion: Number(row.configVersion ?? 1),
        updatedBy: String(row.updatedBy),
        updatedAt: String(row.updatedAt),
      });
    }
    const legacy = await getD1()
      .prepare(
        "SELECT key, value_json AS valueJson FROM application_settings WHERE key LIKE 'integration.%'",
      )
      .all<{ key: string; valueJson: string }>();
    for (const row of legacy.results) {
      const id = row.key.replace("integration.", "");
      if (!stored.has(id)) stored.set(id, parseJson(row.valueJson, {}));
    }
    return { integrations: mergeIntegrations(stored), storageAvailable: true };
  } catch (primaryError) {
    try {
      const legacy = await getD1()
        .prepare(
          "SELECT key, value_json AS valueJson FROM application_settings WHERE key LIKE 'integration.%'",
        )
        .all<{ key: string; valueJson: string }>();
      for (const row of legacy.results) {
        stored.set(
          row.key.replace("integration.", ""),
          parseJson(row.valueJson, {}),
        );
      }
      return {
        integrations: mergeIntegrations(stored),
        storageAvailable: true,
        storageWarning:
          "Connector state is using the legacy settings store until the integration migration is available.",
      };
    } catch {
      return {
        integrations: mergeIntegrations(stored),
        storageAvailable: false,
        storageWarning:
          primaryError instanceof Error
            ? `Saved connector state is unavailable: ${primaryError.message}`
            : "Saved connector state is unavailable.",
      };
    }
  }
}

export async function listIntegrations() {
  return (await loadIntegrationState()).integrations;
}

export async function getIntegration(id: string) {
  const all = await listIntegrations();
  return all.find((connection) => connection.id === id) ?? null;
}

export async function getEnvironmentIntegration(
  type: IntegrationType,
  environment: string,
) {
  const all = await listIntegrations();
  return (
    all.find(
      (connection) =>
        connection.type === type && connection.environment === environment,
    ) ?? null
  );
}

export function validateIntegrationUpdate(id: string, value: unknown) {
  const base = DEFAULT_INTEGRATIONS.find((item) => item.id === id);
  if (!base)
    throw new ConnectorError("VALIDATION", "Unknown integration connector.");
  if (!value || typeof value !== "object")
    throw new ConnectorError("VALIDATION", "Connector settings are required.");
  const payload = value as Partial<IntegrationConnection>;
  const allowedFields = new Set(Object.keys(base.nonSecretConfig));
  const config: IntegrationConfig = { ...base.nonSecretConfig };
  for (const [key, fieldValue] of Object.entries(
    payload.nonSecretConfig ?? {},
  )) {
    if (!allowedFields.has(key)) continue;
    if (!["string", "number", "boolean"].includes(typeof fieldValue)) continue;
    config[key] = fieldValue as string | number | boolean;
  }
  const serialized = JSON.stringify(config);
  if (
    /-----BEGIN|password|private[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token/i.test(
      serialized,
    )
  ) {
    throw new ConnectorError(
      "VALIDATION",
      "Secret values are not allowed in connector settings. Use the named runtime secret instead.",
    );
  }
  for (const [key, fieldValue] of Object.entries(config)) {
    if (/url$/i.test(key) && fieldValue) {
      const url = new URL(String(fieldValue));
      if (url.protocol !== "https:")
        throw new ConnectorError("VALIDATION", `${key} must use HTTPS.`);
    }
  }
  if (
    typeof config.port === "number" &&
    (config.port < 1 || config.port > 65535)
  ) {
    throw new ConnectorError("VALIDATION", "Port must be between 1 and 65535.");
  }
  if (
    base.type === "GCP_LOGGING" &&
    !Object.keys(APPROVED_NAMESPACES).includes(String(config.projectId))
  ) {
    throw new ConnectorError(
      "VALIDATION",
      "Only bes-np and bes-prod are approved Logging projects.",
    );
  }
  if (base.type === "GCP_LOGGING") {
    const projectNamespaces = APPROVED_NAMESPACES[
      String(config.projectId) as keyof typeof APPROVED_NAMESPACES
    ] as readonly string[];
    const namespaces = String(config.namespaces)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const microservices = String(config.microservices)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (
      !namespaces.length ||
      namespaces.some((item) => !projectNamespaces.includes(item))
    ) {
      throw new ConnectorError(
        "VALIDATION",
        "Logging namespaces must be a non-empty subset of the approved project namespaces.",
      );
    }
    if (
      !microservices.length ||
      microservices.some(
        (item) => !(APPROVED_MICROSERVICES as readonly string[]).includes(item),
      )
    ) {
      throw new ConnectorError(
        "VALIDATION",
        "Logging microservices must be a non-empty subset of the approved BES services.",
      );
    }
  }
  if (base.type === "GCP_STORAGE") {
    const prefixes = String(config.approvedPrefixes)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (
      !prefixes.length ||
      prefixes.some(
        (item) => !(APPROVED_GCS_PREFIXES as readonly string[]).includes(item),
      )
    ) {
      throw new ConnectorError(
        "VALIDATION",
        "GCS prefixes must be a non-empty subset of the approved BES prefixes.",
      );
    }
  }
  if (base.type === "RUNMYJOBS") {
    for (const key of ["probePath", "jobsPath"]) {
      const path = String(config[key] || "");
      if (path.includes("://") || path.split("/").includes("..")) {
        throw new ConnectorError(
          "VALIDATION",
          `${key} must be a relative API path.`,
        );
      }
    }
    for (const key of [
      "apiKeyHeader",
      "jobsDateParameter",
      "jobsStatusParameter",
      "jobsSearchParameter",
    ]) {
      const name = String(config[key] || "");
      if (name && !/^[A-Za-z0-9_-]{1,80}$/.test(name)) {
        throw new ConnectorError(
          "VALIDATION",
          `${key} contains unsupported characters.`,
        );
      }
    }
  }
  const numericBounds: Record<string, [number, number]> = {
    pollingSeconds: [5, 3600],
    livePollingSeconds: [3, 3600],
    maxScanCount: [10, 5000],
    maxPreviewMb: [0.1, 10],
    maximumRows: [1, 10000],
    timeoutSeconds: [1, 120],
  };
  for (const [key, [minimum, maximum]] of Object.entries(numericBounds)) {
    if (config[key] == null) continue;
    const number = Number(config[key]);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
      throw new ConnectorError(
        "VALIDATION",
        `${key} must be between ${minimum} and ${maximum}.`,
      );
    }
  }
  return {
    ...base,
    ...payload,
    id: base.id,
    type: base.type,
    displayName: base.displayName,
    description: base.description,
    nonSecretConfig: config,
    secretReference: base.secretReference,
    capabilities: Array.isArray(payload.capabilities)
      ? payload.capabilities.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  } as IntegrationConnection;
}

export async function saveIntegration(
  connection: IntegrationConnection,
  actorId: string,
) {
  const previous = await getIntegration(connection.id);
  const next: IntegrationConnection = {
    ...connection,
    status: !connection.enabled
      ? "DISABLED"
      : missingRequiredFields(connection).length ||
          !secretConfigured(connection.id, connection)
        ? "NOT_CONFIGURED"
        : "READY",
    configVersion: (previous?.configVersion ?? 0) + 1,
    updatedBy: actorId,
    updatedAt: new Date().toISOString(),
  };
  await writeIntegration(next);
  await recordIntegrationAudit({
    eventType: "INTEGRATION_CONFIG_UPDATED",
    actorId,
    environment: next.environment,
    integration: next.type,
    targetId: next.id,
    result: "SUCCEEDED",
    correlationId: `cfg_${crypto.randomUUID()}`,
    detail: { configVersion: next.configVersion, enabled: next.enabled },
  }).catch(() => undefined);
  return next;
}

async function writeIntegration(connection: IntegrationConnection) {
  await getD1()
    .prepare(
      `INSERT INTO integration_connections
      (id, type, display_name, environment, description, enabled, non_secret_config_json,
       secret_reference, status, last_tested_at, last_latency_ms, capabilities_json,
       last_error_category, last_diagnostic, last_correlation_id, config_version, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       environment = excluded.environment, enabled = excluded.enabled,
       non_secret_config_json = excluded.non_secret_config_json,
       status = excluded.status, last_tested_at = excluded.last_tested_at,
       last_latency_ms = excluded.last_latency_ms, capabilities_json = excluded.capabilities_json,
       last_error_category = excluded.last_error_category, last_diagnostic = excluded.last_diagnostic,
       last_correlation_id = excluded.last_correlation_id, config_version = excluded.config_version,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(
      connection.id,
      connection.type,
      connection.displayName,
      connection.environment,
      connection.description,
      connection.enabled ? 1 : 0,
      JSON.stringify(connection.nonSecretConfig),
      connection.secretReference,
      connection.status,
      connection.lastTestedAt ?? null,
      connection.lastLatencyMs ?? null,
      JSON.stringify(connection.capabilities),
      connection.lastErrorCategory ?? null,
      connection.lastDiagnostic ?? null,
      connection.lastCorrelationId ?? null,
      connection.configVersion,
      connection.updatedBy,
      connection.updatedAt || new Date().toISOString(),
    )
    .run();
}

export async function recordIntegrationAudit(input: {
  eventType: string;
  actorId: string;
  environment: string;
  integration: string;
  targetId: string;
  result: string;
  durationMs?: number;
  rowCount?: number;
  correlationId: string;
  detail?: Record<string, unknown>;
}) {
  await getD1()
    .prepare(
      `INSERT INTO integration_audit_events
      (id, event_type, actor_id, environment, integration, target_id, result,
       duration_ms, row_count, correlation_id, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.eventType,
      input.actorId,
      input.environment,
      input.integration,
      input.targetId,
      input.result,
      input.durationMs ?? null,
      input.rowCount ?? null,
      input.correlationId,
      JSON.stringify(input.detail ?? {}),
    )
    .run();
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemBytes(pem: string) {
  const base64 = pem.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    "",
  );
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

const cachedGcpTokens = new Map<string, { token: string; expiresAt: number }>();

export async function getGcpAccessToken(connection: IntegrationConnection) {
  const cached = cachedGcpTokens.get(connection.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const direct = runtimeSecret(connection.id, connection);
  if (!direct)
    throw new ConnectorError(
      "CONFIGURATION",
      "The GCP runtime identity is not configured.",
    );
  if (direct.name.endsWith("ACCESS_TOKEN")) return direct.value;
  const account = JSON.parse(direct.value) as {
    client_email?: string;
    private_key?: string;
    token_uri?: string;
  };
  if (!account.client_email || !account.private_key)
    throw new ConnectorError(
      "AUTHENTICATION",
      "The configured service account is incomplete.",
    );
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const issuedAt = Math.floor(Date.now() / 1000);
  const encodeJson = (value: unknown) =>
    base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const claims = encodeJson({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform.read-only",
    aud: tokenUri,
    iat: issuedAt,
    exp: issuedAt + 3600,
  });
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signed))}`;
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !result.access_token)
    throw new ConnectorError(
      "AUTHENTICATION",
      `GCP identity exchange returned HTTP ${response.status}.`,
    );
  cachedGcpTokens.set(connection.id, {
    token: result.access_token,
    expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000,
  });
  return result.access_token;
}

function safeHttpsUrl(value: string, expectedHostSuffix?: string) {
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new ConnectorError(
      "VALIDATION",
      "Only HTTPS connector endpoints are allowed.",
    );
  const host = url.hostname.toLowerCase();
  if (expectedHostSuffix && !host.endsWith(expectedHostSuffix))
    throw new ConnectorError(
      "VALIDATION",
      `The endpoint must use ${expectedHostSuffix}.`,
    );
  if (
    ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254"].includes(host) ||
    host.endsWith(".local")
  ) {
    throw new ConnectorError(
      "VALIDATION",
      "Local and link-local endpoints are not allowed.",
    );
  }
  return url;
}

function authHeaders(
  connection: IntegrationConnection,
): Record<string, string> {
  const secret = runtimeSecret(connection.id, connection);
  if (!secret)
    throw new ConnectorError(
      "CONFIGURATION",
      `Configure the ${connection.secretReference} runtime secret before testing.`,
    );
  if (connection.type === "RUNMYJOBS") {
    const mode = String(connection.nonSecretConfig.authentication || "BEARER");
    if (mode === "BASIC")
      return { Authorization: `Basic ${btoa(secret.value)}` };
    if (mode === "API_KEY")
      return {
        [String(connection.nonSecretConfig.apiKeyHeader || "X-API-Key")]:
          secret.value,
      };
  }
  return { Authorization: `Bearer ${secret.value}` };
}

export function connectorAuthHeaders(connection: IntegrationConnection) {
  return authHeaders(connection);
}

export function connectorHttpsUrl(value: string, expectedHostSuffix?: string) {
  return safeHttpsUrl(value, expectedHostSuffix);
}

function categorizeStatus(status: number) {
  if (status === 401) return "AUTHENTICATION";
  if (status === 403) return "AUTHORIZATION";
  if (status === 408 || status === 504) return "NETWORK";
  if (status === 429) return "RATE_LIMIT";
  return status >= 500 ? "UPSTREAM" : "VALIDATION";
}

async function testRunMyJobs(connection: IntegrationConnection) {
  const swaggerUrl = safeHttpsUrl(
    String(connection.nonSecretConfig.swaggerUrl),
    ".runmyjobs.cloud",
  );
  const headers = {
    Accept: "application/yaml,application/json,text/plain",
    ...authHeaders(connection),
  };
  const swagger = await fetch(swaggerUrl, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (!swagger.ok)
    throw new ConnectorError(
      categorizeStatus(swagger.status),
      `RunMyJobs Swagger returned HTTP ${swagger.status}.`,
    );
  const text = await swagger.text();
  if (!/swagger|openapi/i.test(text))
    throw new ConnectorError(
      "UPSTREAM",
      "The configured Swagger URL did not return an OpenAPI document.",
    );
  const capabilities = ["SWAGGER_READ", "READ_ONLY_API"];
  const probePath = String(connection.nonSecretConfig.probePath || "").trim();
  if (!probePath)
    return {
      status: "DEGRADED" as const,
      capabilities,
      diagnostic:
        "Swagger authentication succeeded. Add a harmless read-only probe path from this tenant Swagger to complete the live test.",
    };
  const base = String(connection.nonSecretConfig.restBaseUrl).replace(
    /\/$/,
    "",
  );
  const probeUrl = safeHttpsUrl(
    `${base}/${probePath.replace(/^\//, "")}`,
    ".runmyjobs.cloud",
  );
  const probe = await fetch(probeUrl, {
    headers: { Accept: "application/json", ...authHeaders(connection) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!probe.ok)
    throw new ConnectorError(
      categorizeStatus(probe.status),
      `RunMyJobs probe returned HTTP ${probe.status}.`,
    );
  return {
    status: "CONNECTED" as const,
    capabilities: [...capabilities, "READ_ENDPOINT"],
    diagnostic:
      "Swagger and the configured read-only tenant endpoint both succeeded.",
  };
}

async function testCloudLogging(connection: IntegrationConnection) {
  const projectId = String(connection.nonSecretConfig.projectId);
  const token = await getGcpAccessToken(connection);
  const newest = new Date();
  const oldest = new Date(newest.getTime() - 5 * 60_000);
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
        filter: `resource.type=\"${String(connection.nonSecretConfig.resourceType)}\" AND timestamp>=\"${oldest.toISOString()}\" AND timestamp<=\"${newest.toISOString()}\"`,
        orderBy: "timestamp desc",
        pageSize: 1,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw new ConnectorError(
      categorizeStatus(response.status),
      `Cloud Logging entries.list returned HTTP ${response.status}.`,
    );
  return {
    status: "CONNECTED" as const,
    capabilities: ["HISTORICAL_SEARCH", "CONTROLLED_LIVE_POLLING"],
    diagnostic:
      "Cloud Logging accepted an authenticated allowlisted entries.list request.",
  };
}

async function testCloudStorage(connection: IntegrationConnection) {
  const token = await getGcpAccessToken(connection);
  const bucket = String(connection.nonSecretConfig.bucket);
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`,
  );
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("fields", "items(name),nextPageToken");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new ConnectorError(
      categorizeStatus(response.status),
      `Cloud Storage objects.list returned HTTP ${response.status}.`,
    );
  const capabilities = ["LIST_OBJECTS", "PREVIEW_OBJECT"];
  if (connection.nonSecretConfig.allowDownload)
    capabilities.push("DOWNLOAD_OBJECT");
  return {
    status: "CONNECTED" as const,
    capabilities,
    diagnostic:
      "Cloud Storage accepted an authenticated one-object listing request.",
  };
}

async function testGateway(connection: IntegrationConnection) {
  const gatewayUrl = safeHttpsUrl(
    String(connection.nonSecretConfig.gatewayUrl),
  );
  const operation =
    connection.type === "ORACLE" ? "oracle_health_check" : "mongodb_ping";
  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeaders(connection),
    },
    body: JSON.stringify({
      operation,
      readOnly: true,
      environment: connection.environment,
    }),
    signal: AbortSignal.timeout(
      Math.min(
        Math.max(
          Number(connection.nonSecretConfig.timeoutSeconds || 10) * 1000,
          1_000,
        ),
        10_000,
      ),
    ),
  });
  const result = (await response.json().catch(() => ({}))) as {
    healthy?: boolean;
    healthCheck?: number;
    ok?: number;
    message?: string;
  };
  if (!response.ok || result.healthy === false)
    throw new ConnectorError(
      categorizeStatus(response.status),
      result.message ||
        `${connection.displayName} gateway returned HTTP ${response.status}.`,
    );
  if (
    connection.type === "ORACLE" &&
    result.healthCheck != null &&
    result.healthCheck !== 1 &&
    result.ok !== 1
  ) {
    throw new ConnectorError(
      "UPSTREAM",
      "Oracle gateway responded, but SELECT 1 FROM DUAL was not verified.",
    );
  }
  return {
    status: "CONNECTED" as const,
    capabilities:
      connection.type === "ORACLE"
        ? ["SELECT_DUAL", "APPROVED_READ_QUERY"]
        : ["ADMIN_PING", "APPROVED_READ_QUERY"],
    diagnostic:
      result.message ||
      `${connection.displayName} gateway completed its real read-only health operation.`,
  };
}

export async function testIntegration(
  connection: IntegrationConnection,
): Promise<TestResult> {
  const started = Date.now();
  const correlationId = `health_${crypto.randomUUID()}`;
  if (!connection.enabled)
    return {
      status: "FAILED",
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      capabilities: [],
      errorCategory: "CONFIGURATION",
      diagnostic: "This connector is disabled.",
      correlationId,
    };
  const missing = missingRequiredFields(connection);
  if (missing.length)
    return {
      status: "FAILED",
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      capabilities: [],
      errorCategory: "CONFIGURATION",
      diagnostic: `Complete the required settings: ${missing.join(", ")}.`,
      correlationId,
    };
  try {
    const result =
      connection.type === "RUNMYJOBS"
        ? await testRunMyJobs(connection)
        : connection.type === "GCP_LOGGING"
          ? await testCloudLogging(connection)
          : connection.type === "GCP_STORAGE"
            ? await testCloudStorage(connection)
            : await testGateway(connection);
    return {
      ...result,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      correlationId,
    };
  } catch (error) {
    const category =
      error instanceof ConnectorError
        ? error.category
        : error instanceof DOMException && error.name === "TimeoutError"
          ? "NETWORK"
          : "UPSTREAM";
    return {
      status: "FAILED",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      capabilities: [],
      errorCategory: category,
      diagnostic:
        error instanceof Error ? error.message : "The connector test failed.",
      correlationId,
    };
  }
}

export async function persistTestResult(
  connection: IntegrationConnection,
  result: TestResult,
  actorId: string,
) {
  const next: IntegrationConnection = {
    ...connection,
    status: result.status,
    lastTestedAt: result.checkedAt,
    lastLatencyMs: result.latencyMs,
    capabilities: result.capabilities,
    lastErrorCategory: result.errorCategory,
    lastDiagnostic: result.diagnostic,
    lastCorrelationId: result.correlationId,
    updatedBy: actorId,
    updatedAt: result.checkedAt,
  };
  await writeIntegration(next);
  await recordIntegrationAudit({
    eventType: "CONNECTION_TESTED",
    actorId,
    environment: next.environment,
    integration: next.type,
    targetId: next.id,
    result: result.status === "CONNECTED" ? "SUCCEEDED" : result.status,
    durationMs: result.latencyMs,
    correlationId: result.correlationId,
    detail: {
      category: result.errorCategory,
      capabilities: result.capabilities,
    },
  }).catch(() => undefined);
  return next;
}
