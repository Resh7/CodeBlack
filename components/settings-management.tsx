"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  Check,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Database,
  FileClock,
  KeyRound,
  Loader2,
  LockKeyhole,
  Network,
  Pencil,
  RefreshCw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  TestTube2,
  Unplug,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type IntegrationStatus =
  | "NOT_CONFIGURED"
  | "DISABLED"
  | "READY"
  | "TESTING"
  | "CONNECTED"
  | "DEGRADED"
  | "FAILED";
type Config = Record<string, string | number | boolean>;
type Integration = {
  id: string;
  type: "RUNMYJOBS" | "GCP_LOGGING" | "GCP_STORAGE" | "ORACLE" | "MONGODB";
  displayName: string;
  environment: string;
  description: string;
  enabled: boolean;
  nonSecretConfig: Config;
  secretReference: string;
  secretConfigured: boolean;
  requiredFields: string[];
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
type AuditEvent = {
  id: string;
  eventType: string;
  actorId: string;
  result: string;
  durationMs?: number;
  correlationId: string;
  occurredAt: string;
};
type Field = {
  key: string;
  label: string;
  help: string;
  type?: "number" | "boolean" | "select";
  options?: string[];
  required?: boolean;
  placeholder?: string;
};

const connectorIcons = {
  RUNMYJOBS: Activity,
  GCP_LOGGING: Server,
  GCP_STORAGE: Cloud,
  ORACLE: Database,
  MONGODB: Database,
};

const fields: Record<Integration["type"], Field[]> = {
  RUNMYJOBS: [
    {
      key: "consoleRoot",
      label: "Console root",
      help: "Browser console root. The connector does not scrape or automate this page.",
      required: true,
    },
    {
      key: "company",
      label: "Company path",
      help: "Tenant company segment used to construct the API route.",
      required: true,
    },
    {
      key: "tenantEnvironment",
      label: "Tenant environment",
      help: "RunMyJobs environment path, such as dev or prod.",
      required: true,
    },
    {
      key: "restBaseUrl",
      label: "REST base URL",
      help: "Exact Inbound REST Extension v1 URL from the tenant.",
      required: true,
    },
    {
      key: "swaggerUrl",
      label: "Swagger URL",
      help: "Exact tenant swagger.yml URL used to discover supported operations.",
      required: true,
    },
    {
      key: "probePath",
      label: "Read-only probe path",
      help: "A harmless GET path confirmed by the imported Swagger. Required for a fully Connected test.",
      placeholder: "Example from your tenant Swagger",
    },
    {
      key: "jobsPath",
      label: "Jobs collection path",
      help: "Only add the job collection path if it exists in the tenant Swagger.",
      placeholder: "Leave blank until Swagger confirms it",
    },
    {
      key: "jobsDateParameter",
      label: "Business-date parameter",
      help: "Exact query-parameter name from Swagger. Leave blank if this endpoint does not support a date filter.",
    },
    {
      key: "jobsStatusParameter",
      label: "Status parameter",
      help: "Exact status query-parameter name from Swagger. Leave blank if unsupported.",
    },
    {
      key: "jobsSearchParameter",
      label: "Search parameter",
      help: "Exact job-name search parameter from Swagger. Leave blank if unsupported.",
    },
    {
      key: "authentication",
      label: "Authentication mode",
      help: "Must match the administrator-approved tenant mode.",
      type: "select",
      options: ["BEARER", "API_KEY", "BASIC"],
      required: true,
    },
    {
      key: "apiKeyHeader",
      label: "API key header",
      help: "Header name used only when API_KEY authentication is selected.",
    },
    {
      key: "pollingSeconds",
      label: "Active-job polling seconds",
      help: "Controlled polling interval. Minimum operational recommendation is 30 seconds.",
      type: "number",
    },
  ],
  GCP_LOGGING: [
    {
      key: "projectId",
      label: "GCP project ID",
      help: "Allowed values are bes-np and bes-prod.",
      type: "select",
      options: ["bes-np", "bes-prod"],
      required: true,
    },
    {
      key: "resourceType",
      label: "Logging resource type",
      help: "Confirm from a real expanded entry before production use.",
      required: true,
    },
    {
      key: "namespaces",
      label: "Approved namespaces",
      help: "Comma-separated allowlist. The backend validates each selection.",
      required: true,
    },
    {
      key: "microservices",
      label: "Approved microservices",
      help: "Comma-separated allowlist used by the server-generated Logging filter.",
      required: true,
    },
    {
      key: "retentionDays",
      label: "Confirmed retention days",
      help: "Leave blank until the GCP administrator confirms the real retention period.",
    },
    {
      key: "livePollingSeconds",
      label: "Live polling seconds",
      help: "Phase 1 live mode never polls faster than every 3 seconds.",
      type: "number",
    },
  ],
  GCP_STORAGE: [
    {
      key: "projectId",
      label: "Owning project",
      help: "Project used for operator context and IAM review.",
      required: true,
    },
    {
      key: "bucket",
      label: "Approved bucket",
      help: "Restricted to the BES integration bucket in this release.",
      required: true,
    },
    {
      key: "basePath",
      label: "Base path",
      help: "Optional additional root restriction. Prefix matching remains case-sensitive.",
    },
    {
      key: "approvedPrefixes",
      label: "Approved prefixes",
      help: "Comma-separated, case-sensitive prefix allowlist.",
      required: true,
    },
    {
      key: "maxScanCount",
      label: "Maximum object scan",
      help: "Prevents unlimited metadata scans in large folders.",
      type: "number",
    },
    {
      key: "maxPreviewMb",
      label: "Maximum preview MB",
      help: "Oversized files remain downloadable only when approved.",
      type: "number",
    },
    {
      key: "allowDownload",
      label: "Allow audited downloads",
      help: "Disable to permit metadata and preview only.",
      type: "boolean",
    },
  ],
  ORACLE: [
    {
      key: "host",
      label: "Oracle hostname",
      help: "Private Oracle listener hostname retained for operator reference.",
      required: true,
    },
    {
      key: "port",
      label: "Listener port",
      help: "Validated TCP port. The website itself connects through the HTTPS gateway.",
      type: "number",
      required: true,
    },
    {
      key: "serviceName",
      label: "Service name",
      help: "Exact Oracle service name used by the private gateway.",
      required: true,
    },
    {
      key: "gatewayUrl",
      label: "Private HTTPS connector gateway",
      help: "Organization-approved HTTPS endpoint running node-oracledb inside the network path.",
      required: true,
      placeholder: "https://approved-gateway.example/health/oracle",
    },
    {
      key: "tlsMode",
      label: "TLS / wallet mode",
      help: "Confirm Oracle wallet, TLS, and network-encryption requirements before testing.",
      type: "select",
      options: ["TO_BE_CONFIRMED", "THIN_TLS", "WALLET_REQUIRED"],
    },
    {
      key: "approvedSchemas",
      label: "Approved schemas or views",
      help: "Comma-separated read allowlist. Do not grant SELECT ANY TABLE.",
      required: true,
    },
    {
      key: "maximumRows",
      label: "Maximum returned rows",
      help: "Hard response limit for approved SELECT queries.",
      type: "number",
    },
    {
      key: "timeoutSeconds",
      label: "Health timeout seconds",
      help: "Connection tests stop at 10 seconds in this proof of concept.",
      type: "number",
    },
  ],
  MONGODB: [
    {
      key: "clusterHost",
      label: "Atlas cluster host",
      help: "Host contains pr and is treated as production until confirmed otherwise.",
      required: true,
    },
    {
      key: "database",
      label: "Approved database",
      help: "Exact database for the read-only Atlas user.",
      required: true,
    },
    {
      key: "gatewayUrl",
      label: "Private HTTPS connector gateway",
      help: "Approved HTTPS endpoint using the official MongoDB driver and private network access.",
      required: true,
      placeholder: "https://approved-gateway.example/health/mongodb",
    },
    {
      key: "approvedCollections",
      label: "Approved collections",
      help: "Comma-separated collection allowlist. Unrelated databases are never listed.",
      required: true,
    },
    {
      key: "productionApproved",
      label: "Production access approved",
      help: "Keep disabled until data-owner and security approval is recorded.",
      type: "boolean",
      required: true,
    },
    {
      key: "maximumRows",
      label: "Maximum returned rows",
      help: "Hard result limit for find and approved pipelines.",
      type: "number",
    },
    {
      key: "timeoutSeconds",
      label: "Health timeout seconds",
      help: "Server selection and ping use a short timeout.",
      type: "number",
    },
  ],
};

const prerequisites: Record<Integration["type"], string[]> = {
  RUNMYJOBS: [
    "Exact tenant Swagger and REST paths",
    "Read-only RunMyJobs credential",
    "Harmless GET probe confirmed by Swagger",
    "Object permissions for required views",
  ],
  GCP_LOGGING: [
    "Workload identity or service account",
    "roles/logging.viewer IAM grant",
    "Resource type confirmed from a live entry",
    "Retention and redaction rules confirmed",
  ],
  GCP_STORAGE: [
    "roles/storage.objectViewer on the narrow scope",
    "Complete prefix allowlist",
    "Preview and download approvals",
    "Typical object counts and sizes",
  ],
  ORACLE: [
    "Private network route to port 1521",
    "Read-only Oracle identity",
    "HTTPS gateway running node-oracledb",
    "TLS/wallet mode and approved views",
  ],
  MONGODB: [
    "Production authorization",
    "Atlas network access or private endpoint",
    "Read-only user on one database",
    "HTTPS gateway using the MongoDB driver",
  ],
};

const statusCopy: Record<
  IntegrationStatus,
  { label: string; classes: string }
> = {
  NOT_CONFIGURED: {
    label: "Not configured",
    classes: "border-slate-200 bg-slate-50 text-slate-600",
  },
  DISABLED: {
    label: "Disabled",
    classes: "border-slate-200 bg-slate-100 text-slate-500",
  },
  READY: {
    label: "Ready to test",
    classes: "border-blue-200 bg-blue-50 text-blue-700",
  },
  TESTING: {
    label: "Testing",
    classes: "border-cyan-200 bg-cyan-50 text-cyan-700",
  },
  CONNECTED: {
    label: "Connected",
    classes: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  DEGRADED: {
    label: "Degraded",
    classes: "border-amber-200 bg-amber-50 text-amber-700",
  },
  FAILED: {
    label: "Failed",
    classes: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

function StatusBadge({ status }: { status: IntegrationStatus }) {
  const meta = statusCopy[status];
  return (
    <Badge variant="outline" className={`gap-1.5 rounded-full ${meta.classes}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </Badge>
  );
}

function isComplete(value: unknown) {
  return value !== "" && value != null && value !== false;
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "Never";
}

export default function SettingsManagement({
  heading,
  environment,
}: {
  heading: ReactNode;
  environment: string;
}) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [active, setActive] = useState<Integration | null>(null);
  const [draft, setDraft] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/integrations", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        integrations?: Integration[];
        error?: string;
        storageWarning?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to load integrations.");
      setIntegrations(payload.integrations ?? []);
      setStorageWarning(payload.storageWarning ?? null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load integrations.";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function openEditor(connection: Integration) {
    setActive(connection);
    setDraft(structuredClone(connection));
    setAudit([]);
  }

  async function saveCurrent(showToast = true) {
    if (!draft) return null;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, connection: draft }),
      });
      const payload = (await response.json()) as {
        integration?: Integration;
        error?: string;
      };
      if (!response.ok || !payload.integration)
        throw new Error(payload.error ?? "Unable to save integration.");
      if (showToast) toast.success(`${draft.displayName} settings saved`);
      await load();
      setActive(payload.integration);
      setDraft(payload.integration);
      return payload.integration;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save integration.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(
    connection: Integration,
    saveDraftFirst = false,
  ) {
    const target = saveDraftFirst ? await saveCurrent(false) : connection;
    if (!target) return;
    setTestingId(target.id);
    try {
      const response = await fetch(
        `/api/admin/integrations/${target.id}/test`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        result?: { status: IntegrationStatus; diagnostic: string };
        error?: string;
      };
      if (!payload.result)
        throw new Error(payload.error ?? "Connection test failed.");
      if (payload.result.status === "CONNECTED")
        toast.success(`${target.displayName} connected`);
      else if (payload.result.status === "DEGRADED")
        toast.warning(payload.result.diagnostic);
      else toast.error(payload.result.diagnostic);
      const refresh = await fetch("/api/admin/integrations", {
        cache: "no-store",
      });
      const refreshed = (await refresh.json()) as {
        integrations?: Integration[];
      };
      setIntegrations(refreshed.integrations ?? []);
      const updated = refreshed.integrations?.find(
        (item) => item.id === target.id,
      );
      if (updated && active?.id === target.id) {
        setActive(updated);
        setDraft(updated);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Connection test failed.",
      );
    } finally {
      setTestingId(null);
    }
  }

  async function loadAudit(id: string) {
    setAuditLoading(true);
    try {
      const response = await fetch(`/api/admin/integrations/${id}/audit`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        events?: AuditEvent[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to load audit history.");
      setAudit(payload.events ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load audit history.",
      );
    } finally {
      setAuditLoading(false);
    }
  }

  const environmentIntegrations = useMemo(
    () => integrations.filter((item) => item.environment === environment),
    [environment, integrations],
  );
  const metrics = useMemo(
    () => ({
      connected: environmentIntegrations.filter(
        (item) => item.status === "CONNECTED",
      ).length,
      ready: environmentIntegrations.filter(
        (item) => item.status === "READY" || item.status === "DEGRADED",
      ).length,
      blocked: environmentIntegrations.filter(
        (item) => item.status === "NOT_CONFIGURED" || item.status === "FAILED",
      ).length,
    }),
    [environmentIntegrations],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>{heading}</div>
        <Button
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Reload runtime state
        </Button>
      </div>

      <div className="ops-source-banner overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-white shadow-lg">
        <div className="grid gap-6 p-5 lg:grid-cols-[1.35fr_1fr] lg:p-6">
          <div>
            <div className="flex items-center gap-2 text-cyan-300">
              <ShieldCheck className="size-4" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                Read-only enterprise release
              </span>
            </div>
            <h2 className="mt-3 text-xl font-semibold">
              Integration control plane
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Every connector is configured separately, tested by a real
              server-side health operation, and isolated when an upstream system
              is unavailable. No sample response can produce a Connected badge.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Connected", metrics.connected, "text-emerald-300"],
              ["Ready", metrics.ready, "text-cyan-300"],
              ["Blocked", metrics.blocked, "text-amber-300"],
            ].map(([label, value, tone]) => (
              <div
                key={String(label)}
                className="rounded-xl border border-white/10 bg-white/[0.04] p-3"
              >
                <p className={`text-2xl font-semibold ${tone}`}>
                  {Number(value)}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-400">
                  {String(label)}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 px-5 py-3 text-[11px] text-slate-400 lg:px-6">
          <span className="flex items-center gap-1.5">
            <LockKeyhole className="size-3.5" />
            Secrets never returned to the browser
          </span>
          <span className="flex items-center gap-1.5">
            <Network className="size-3.5" />
            10 second connection-test target
          </span>
          <span className="flex items-center gap-1.5">
            <FileClock className="size-3.5" />
            Configuration and tests audited
          </span>
        </div>
      </div>

      {(loadError || storageWarning) && (
        <div
          className={`rounded-2xl border p-4 ${loadError ? "border-rose-200 bg-rose-50 text-rose-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}
        >
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">
                {loadError
                  ? "Settings API is unavailable"
                  : "Connector storage notice"}
              </p>
              <p className="mt-1 text-xs leading-5">
                {loadError ?? storageWarning}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {environmentIntegrations.map((connection) => {
          const Icon = connectorIcons[connection.type];
          const required = connection.requiredFields ?? [];
          const complete = required.filter((field) =>
            isComplete(connection.nonSecretConfig[field]),
          ).length;
          return (
            <section
              key={connection.id}
              className={`relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md ${connection.environment === "PROD" ? "border-rose-200" : "border-slate-200"}`}
            >
              <div
                className={`absolute inset-y-0 left-0 w-1 ${connection.status === "CONNECTED" ? "bg-emerald-500" : connection.status === "FAILED" ? "bg-rose-500" : connection.status === "DEGRADED" ? "bg-amber-500" : "bg-slate-300"}`}
              />
              <div className="p-5 pl-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-700">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-slate-950">
                        {connection.displayName}
                      </h2>
                      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                        {connection.environment}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={connection.status} />
                </div>
                <p className="mt-4 min-h-12 text-xs leading-5 text-slate-500">
                  {connection.description}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">
                      Required settings
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      {complete} / {required.length}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">
                      Runtime secret
                    </p>
                    <p
                      className={`mt-1 text-sm font-semibold ${connection.secretConfigured ? "text-emerald-700" : "text-amber-700"}`}
                    >
                      {connection.secretConfigured ? "Configured" : "Missing"}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">
                      Last test
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {formatTime(connection.lastTestedAt)}
                      {connection.lastLatencyMs != null
                        ? ` · ${connection.lastLatencyMs} ms`
                        : ""}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditor(connection)}
                    >
                      <Pencil className="size-3.5" />
                      Configure
                    </Button>
                    <Button
                      size="sm"
                      className="bg-slate-900 text-white hover:bg-slate-800"
                      disabled={testingId != null}
                      onClick={() => void testConnection(connection)}
                    >
                      {testingId === connection.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <TestTube2 className="size-3.5" />
                      )}
                      Test
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {!integrations.length && !loading && (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
          <Unplug className="mx-auto size-9 text-slate-300" />
          <p className="mt-3 font-medium text-slate-800">
            No integration definitions were returned
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Reload the runtime state or review the API message above.
          </p>
        </div>
      )}

      <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 size-5 text-cyan-700" />
          <div>
            <h2 className="text-sm font-semibold text-cyan-950">
              Private database connectivity requirement
            </h2>
            <p className="mt-1 text-xs leading-5 text-cyan-900">
              This hosted website cannot open raw Oracle or MongoDB sockets.
              Oracle and MongoDB must be reached through organization-approved
              private HTTPS gateways that run node-oracledb and the official
              MongoDB driver inside the approved network. The Settings fields
              above capture those gateway URLs and verify their real health
              contracts.
            </p>
          </div>
        </div>
      </section>

      <Sheet
        open={Boolean(active)}
        onOpenChange={(open) => {
          if (!open) {
            setActive(null);
            setDraft(null);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-3xl">
          <SheetHeader className="border-b border-slate-100 p-6">
            <div className="flex items-center gap-2">
              <StatusBadge status={active?.status ?? "NOT_CONFIGURED"} />
              {active?.environment === "PROD" && (
                <Badge className="bg-rose-600">Production</Badge>
              )}
            </div>
            <SheetTitle className="mt-3 text-2xl">
              {active?.displayName}
            </SheetTitle>
            <SheetDescription>{active?.description}</SheetDescription>
          </SheetHeader>
          {draft && (
            <Tabs defaultValue="configuration" className="p-6">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="configuration">
                  <Settings2 className="size-3.5" />
                  Configuration
                </TabsTrigger>
                <TabsTrigger value="requirements">
                  <ShieldCheck className="size-3.5" />
                  Requirements
                </TabsTrigger>
                <TabsTrigger
                  value="audit"
                  onClick={() => void loadAudit(draft.id)}
                >
                  <FileClock className="size-3.5" />
                  Audit
                </TabsTrigger>
              </TabsList>
              <TabsContent value="configuration" className="mt-5 space-y-5">
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Connector enabled
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Disabled connectors cannot be queried or tested.
                    </p>
                  </div>
                  <Switch
                    checked={draft.enabled}
                    onCheckedChange={(checked) =>
                      setDraft({ ...draft, enabled: checked })
                    }
                  />
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <KeyRound className="mt-0.5 size-4 text-amber-700" />
                    <div>
                      <p className="text-sm font-semibold text-amber-950">
                        Write-only runtime secret
                      </p>
                      <p className="mt-1 text-xs leading-5 text-amber-900">
                        Configure{" "}
                        <code className="rounded bg-white/70 px-1 py-0.5 font-mono">
                          {draft.secretReference}
                        </code>{" "}
                        in the approved hosted secret channel. Current state:{" "}
                        <strong>
                          {draft.secretConfigured
                            ? "Configured"
                            : "Not configured"}
                        </strong>
                        . Existing secret values are never displayed or saved in
                        this form.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid gap-4">
                  {(fields[draft.type] ?? []).map((field) => {
                    const value = draft.nonSecretConfig[field.key];
                    return (
                      <label key={field.key} className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                          {field.label}
                          {field.required && (
                            <span className="text-rose-600">*</span>
                          )}
                          {field.required && isComplete(value) && (
                            <Check className="size-3.5 text-emerald-600" />
                          )}
                        </span>
                        {field.type === "boolean" ? (
                          <Select
                            value={value ? "true" : "false"}
                            onValueChange={(next) =>
                              setDraft({
                                ...draft,
                                nonSecretConfig: {
                                  ...draft.nonSecretConfig,
                                  [field.key]: next === "true",
                                },
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">Yes</SelectItem>
                              <SelectItem value="false">No</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : field.type === "select" ? (
                          <Select
                            value={String(value)}
                            onValueChange={(next) =>
                              setDraft({
                                ...draft,
                                nonSecretConfig: {
                                  ...draft.nonSecretConfig,
                                  [field.key]: next,
                                },
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {field.options?.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option.replaceAll("_", " ")}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            type={field.type === "number" ? "number" : "text"}
                            value={String(value ?? "")}
                            placeholder={field.placeholder}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                nonSecretConfig: {
                                  ...draft.nonSecretConfig,
                                  [field.key]:
                                    field.type === "number"
                                      ? Number(event.target.value)
                                      : event.target.value,
                                },
                              })
                            }
                          />
                        )}
                        <span className="text-[11px] leading-4 text-slate-400">
                          {field.help}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {draft.lastDiagnostic && (
                  <div
                    className={`rounded-xl border p-4 ${draft.status === "CONNECTED" ? "border-emerald-200 bg-emerald-50" : draft.status === "DEGRADED" ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50"}`}
                  >
                    <div className="flex items-start gap-3">
                      {draft.status === "CONNECTED" ? (
                        <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
                      ) : (
                        <CircleAlert className="mt-0.5 size-4 text-amber-700" />
                      )}
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          Last real connection test
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-700">
                          {draft.lastDiagnostic}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {draft.lastErrorCategory && (
                            <Badge variant="outline">
                              {draft.lastErrorCategory}
                            </Badge>
                          )}
                          {draft.lastLatencyMs != null && (
                            <Badge variant="outline">
                              {draft.lastLatencyMs} ms
                            </Badge>
                          )}
                          {draft.lastCorrelationId && (
                            <Badge variant="outline" className="font-mono">
                              {draft.lastCorrelationId}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="requirements" className="mt-5 space-y-4">
                <div className="rounded-xl border border-slate-200 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Administrator inputs required
                  </h3>
                  <div className="mt-3 space-y-2">
                    {(prerequisites[draft.type] ?? []).map((item) => (
                      <div
                        key={item}
                        className="flex items-start gap-2 text-xs leading-5 text-slate-600"
                      >
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-cyan-700" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Capabilities confirmed by last test
                  </h3>
                  {draft.capabilities.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {draft.capabilities.map((capability) => (
                        <Badge
                          key={capability}
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-700"
                        >
                          {capability.replaceAll("_", " ")}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      No capability has been reported. The website will not
                      infer support until a live test succeeds.
                    </p>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="audit" className="mt-5">
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  {auditLoading ? (
                    <div className="grid min-h-40 place-items-center">
                      <Loader2 className="size-5 animate-spin text-cyan-700" />
                    </div>
                  ) : audit.length ? (
                    <div className="divide-y divide-slate-100">
                      {audit.map((event) => (
                        <div key={event.id} className="p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold text-slate-900">
                              {event.eventType.replaceAll("_", " ")}
                            </p>
                            <Badge
                              variant="outline"
                              className={
                                event.result === "SUCCEEDED"
                                  ? "border-emerald-200 text-emerald-700"
                                  : "border-amber-200 text-amber-700"
                              }
                            >
                              {event.result}
                            </Badge>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {formatTime(event.occurredAt)} · {event.actorId}
                            {event.durationMs != null
                              ? ` · ${event.durationMs} ms`
                              : ""}
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-slate-400">
                            {event.correlationId}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid min-h-40 place-items-center p-6 text-center">
                      <div>
                        <FileClock className="mx-auto size-7 text-slate-300" />
                        <p className="mt-2 text-sm text-slate-600">
                          No audit events recorded yet
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}
          <SheetFooter className="border-t border-slate-100 p-5 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => {
                setActive(null);
                setDraft(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={!draft || saving || testingId != null}
              onClick={() => draft && void testConnection(draft, true)}
            >
              {testingId === draft?.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wifi className="size-4" />
              )}
              Save and test
            </Button>
            <Button
              className="bg-cyan-700 text-white hover:bg-cyan-800"
              disabled={!draft || saving}
              onClick={() => void saveCurrent()}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save configuration
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
