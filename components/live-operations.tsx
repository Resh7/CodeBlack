"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  CheckCircle2,
  ChevronRight,
  CircleSlash2,
  Copy,
  Database,
  FileSpreadsheet,
  Eye,
  Gauge,
  History,
  Loader2,
  Play,
  Plug,
  RefreshCw,
  Save,
  Search,
  Server,
  ShieldCheck,
  Upload,
  WandSparkles,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  checkReadOnlySql,
  formatSql,
  safeSqlCleanup,
} from "@/lib/sql-query-tools";

type Integration = {
  id: string;
  displayName: string;
  environment: string;
  status: string;
  lastTestedAt?: string;
  lastLatencyMs?: number;
  lastDiagnostic?: string;
};

type LocalConnectorConfig = {
  connectionHealth?: Record<string, boolean>;
};

type Run = {
  id: string;
  jobId: string;
  jobName: string;
  phase: string;
  status: string;
  resultCount?: number | null;
  message: string;
  durationMs?: number | null;
  correlationId?: string | null;
  executedAt: string;
  executedBy: string;
};

type Overview = {
  integrations: Integration[];
  storageAvailable: boolean;
  storageWarning?: string;
  metrics: {
    connectedIntegrations: number;
    configuredIntegrations: number;
    totalIntegrations: number;
    activeWorkbookSources: number;
    activeCatalogJobs: number;
    validationRuns: number;
  };
  catalogCounts: Record<string, number>;
  activeImports: {
    kind: string;
    filename: string;
    uploadedAt: string;
    rowCount: number;
  }[];
  validationStats: {
    status: string;
    count: number;
    averageDurationMs: number | null;
  }[];
  recentRuns: Run[];
  recentAudit: AuditEvent[];
  generatedAt: string;
};

type SchedulerJob = {
  id: string;
  name: string;
  definition?: unknown;
  status?: unknown;
  requestedAt?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  returnCode?: unknown;
  queue?: unknown;
  server?: unknown;
};

type ImportedRmjExport = {
  filename: string;
  importedAt: string;
  jobs: SchedulerJob[];
  columns: string[];
};

const RMJ_DEV_URL =
  "https://oregon.runmyjobs.cloud/eworld-enterprise-solutions/dev/";

function normalizedColumn(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function rmjValue(row: Record<string, unknown>, names: string[]) {
  const matched = Object.keys(row).find((column) =>
    names.includes(normalizedColumn(column)),
  );
  return matched ? row[matched] : undefined;
}

async function parseRmjExport(file: File): Promise<ImportedRmjExport> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const workbook =
    extension === "csv"
      ? XLSX.read(await file.text(), { type: "string", cellDates: true })
      : XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error("The RMJ export has no readable worksheet.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[firstSheet],
    { defval: "", raw: false },
  );
  if (!rows.length) throw new Error("The RMJ export has no data rows.");
  const jobs = rows
    .map((row, index) => {
      const name = rmjValue(row, [
        "jobname",
        "processname",
        "definition",
        "definitionname",
        "processdefinition",
        "name",
        "description",
      ]);
      return {
        id: String(
          rmjValue(row, ["id", "jobid", "processid", "executionid"]) ||
            `import-${index + 1}`,
        ),
        name: String(name || "Unnamed job"),
        definition: rmjValue(row, [
          "definition",
          "definitionname",
          "processdefinition",
          "jobdefinition",
        ]),
        status: rmjValue(row, [
          "status",
          "state",
          "jobstatus",
          "processstatus",
        ]),
        requestedAt: rmjValue(row, [
          "requestedat",
          "submittedat",
          "submittime",
          "createdat",
        ]),
        startedAt: rmjValue(row, [
          "startedat",
          "starttime",
          "startdate",
          "runstart",
        ]),
        endedAt: rmjValue(row, ["endedat", "endtime", "enddate", "runend"]),
        returnCode: rmjValue(row, ["returncode", "exitcode", "resultcode"]),
        queue: rmjValue(row, ["queue", "queuename"]),
        server: rmjValue(row, ["server", "servername", "processserver"]),
      } satisfies SchedulerJob;
    })
    .filter((job) => job.name !== "Unnamed job");
  if (!jobs.length)
    throw new Error(
      "No job-name column was recognized. Export a view that includes Job, Process, Definition, or Name.",
    );
  return {
    filename: file.name,
    importedAt: new Date().toISOString(),
    jobs,
    columns: Object.keys(rows[0] || {}),
  };
}

type CatalogJob = {
  id: string;
  jobName: string;
  displayJobName?: string;
  description: string;
  definitionKind: string;
  hasPreValidation: boolean;
  hasPostValidation: boolean;
  preValidation?: string;
  postValidation?: string;
  comment: string;
  sourceImportId: string;
  schedule: string;
  rawJson?: string;
  createdAt: string;
};

type Validation = CatalogJob & {
  scheduleGroup?: string;
  isScheduled?: boolean;
  preInstructions: string;
  postInstructions: string;
  lastRunId?: string;
  lastPhase?: string;
  lastStatus?: string;
  lastResultCount?: number | null;
  lastMessage?: string;
  lastDurationMs?: number | null;
  lastCorrelationId?: string;
  lastExecutedAt?: string;
  preResultCount?: number | null;
  preResultStatus?: string;
  postResultCount?: number | null;
  postResultStatus?: string;
  hasPreMongoValidation?: boolean;
  hasPostMongoValidation?: boolean;
  preSqlResultCount?: number | null;
  preMongoResultCount?: number | null;
  postSqlResultCount?: number | null;
  postMongoResultCount?: number | null;
};

type AuditEvent = {
  id: string;
  eventType: string;
  actorId: string;
  environment: string;
  integration: string;
  targetId: string;
  result: string;
  durationMs?: number | null;
  rowCount?: number | null;
  correlationId: string;
  occurredAt: string;
};

function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetch(url, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const payload = (await response.json()) as T & { error?: string };
          if (!response.ok)
            throw new Error(
              payload.error ?? `Request failed with HTTP ${response.status}.`,
            );
          setData(payload);
        })
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === "AbortError")
            return;
          setError(
            reason instanceof Error
              ? reason.message
              : "The live request failed.",
          );
          setData(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url, revision]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { data, loading, error, reload };
}

function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`ops-surface rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-52 place-items-center px-6 py-12 text-center">
      <div>
        <CircleSlash2 className="mx-auto size-9 text-slate-300" />
        <p className="mt-3 text-sm font-semibold text-slate-800">{title}</p>
        <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-slate-500">
          {detail}
        </p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <div>
          <p className="text-sm font-semibold text-amber-950">
            Live data is not available
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-900">{message}</p>
        </div>
      </div>
    </div>
  );
}

function Busy() {
  return (
    <div className="grid min-h-52 place-items-center">
      <Loader2 className="size-6 animate-spin text-cyan-700" />
    </div>
  );
}

function statusTone(status?: string) {
  const value = String(status || "UNKNOWN").toUpperCase();
  if (
    ["SUCCESS", "SUCCEEDED", "CONNECTED", "COMPLETED", "FINISHED"].includes(
      value,
    )
  )
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["FAILED", "ERROR", "ABORTED"].includes(value))
    return "border-rose-200 bg-rose-50 text-rose-700";
  if (["RUNNING", "ACTIVE", "EXECUTING"].includes(value))
    return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (["DEGRADED", "WARNING", "CONFIGURATION_REQUIRED"].includes(value))
    return "border-amber-200 bg-amber-50 text-amber-700";
  if (["READY", "SCHEDULED", "QUEUED"].includes(value))
    return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function StatusBadge({ status }: { status?: string }) {
  const label = String(status || "Not reported").replaceAll("_", " ");
  return (
    <Badge variant="outline" className={`rounded-full ${statusTone(status)}`}>
      {label}
    </Badge>
  );
}

function formatDate(value?: unknown) {
  if (!value) return "Not reported";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card className="ops-metric">
      <div className="ops-metric-top">
        <p className="ops-metric-label">{label}</p>
        <div className={`ops-metric-icon ${tone}`}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </div>
      <p className="ops-metric-value">{value}</p>
      <div className="ops-metric-footer">
        <p>{detail}</p>
        {onAction ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onAction}
            className="ops-metric-action"
          >
            {actionLabel}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function ScheduledJobsTable({ jobs }: { jobs: CatalogJob[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Job</TableHead>
          <TableHead>Group / schedule</TableHead>
          <TableHead>Pre</TableHead>
          <TableHead>Post</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell className="font-medium">{job.jobName}</TableCell>
            <TableCell className="text-xs">
              {job.schedule || "Not mapped"}
            </TableCell>
            <TableCell>
              <StatusBadge
                status={job.hasPreValidation ? "READY" : "NOT_CONFIGURED"}
              />
            </TableCell>
            <TableCell>
              <StatusBadge
                status={job.hasPostValidation ? "READY" : "NOT_CONFIGURED"}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DashboardLegacy({
  heading,
  businessDate,
  onOpenSettings,
  onOpenJobs,
}: {
  heading: ReactNode;
  businessDate: string;
  onOpenSettings: () => void;
  onOpenJobs: () => void;
}) {
  const overview = useApi<Overview>("/api/operations/overview");
  const scheduler = useApi<{ jobs: SchedulerJob[]; fetchedAt: string }>(
    `/api/runmyjobs/jobs?businessDate=${encodeURIComponent(businessDate)}`,
  );
  const catalog = useApi<{ jobs: CatalogJob[] }>(
    `/api/jobs?kind=ALL&businessDate=${encodeURIComponent(businessDate)}`,
  );
  if (overview.loading && !overview.data)
    return (
      <div className="space-y-6">
        <div>{heading}</div>
        <Card>
          <Busy />
        </Card>
      </div>
    );
  const data = overview.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>{heading}</div>
        <Button
          variant="outline"
          onClick={() => {
            overview.reload();
            scheduler.reload();
            catalog.reload();
          }}
        >
          <RefreshCw className="size-4" />
          Refresh live state
        </Button>
      </div>
      {overview.error && <ErrorNotice message={overview.error} />}{" "}
      {data?.storageWarning && <ErrorNotice message={data.storageWarning} />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Connected connectors"
          value={`${data?.metrics.connectedIntegrations ?? 0} / ${data?.metrics.totalIntegrations ?? 0}`}
          detail="Only successful health tests count"
          icon={Server}
          tone="bg-emerald-50 text-emerald-700"
        />
        <Metric
          label="Imported catalog"
          value={(data?.metrics.activeCatalogJobs ?? 0).toLocaleString()}
          detail="Active rows from uploaded workbooks"
          icon={Database}
          tone="bg-cyan-50 text-cyan-700"
        />
        <Metric
          label="Workbook sources"
          value={(data?.metrics.activeWorkbookSources ?? 0).toLocaleString()}
          detail="Active Daily, Special, and Validation files"
          icon={FileSpreadsheet}
          tone="bg-violet-50 text-violet-700"
        />
        <Metric
          label="Validation runs"
          value={(data?.metrics.validationRuns ?? 0).toLocaleString()}
          detail="Persisted real execution attempts"
          icon={ShieldCheck}
          tone="bg-amber-50 text-amber-700"
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">
                {scheduler.error
                  ? "Imported jobs for local testing"
                  : `RunMyJobs for ${businessDate}`}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {scheduler.error
                  ? "Actual job rows from the active Daily and Special uploads"
                  : "Direct read from the configured scheduler endpoint"}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onOpenJobs}>
              Open jobs
            </Button>
          </div>
          {scheduler.loading && !scheduler.error ? (
            <Busy />
          ) : scheduler.error ? (
            catalog.loading ? (
              <Busy />
            ) : catalog.data?.jobs.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Job</TableHead>
                    <TableHead>Catalog</TableHead>
                    <TableHead className="pr-5">Schedule</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalog.data.jobs.slice(0, 8).map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="pl-5 font-medium text-slate-900">
                        {job.jobName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{job.definitionKind}</Badge>
                      </TableCell>
                      <TableCell className="pr-5 text-xs text-slate-500">
                        {rawField(job.rawJson, [
                          "schedule",
                          "time",
                          "starttime",
                          "runtime",
                          "frequency",
                        ]) || "From uploaded workbook"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="Upload the job workbook first"
                detail="Dashboard counts and local job rows are generated from the active Daily and Special job uploads."
                action={
                  <Button size="sm" onClick={onOpenJobs}>
                    Open jobs
                  </Button>
                }
              />
            )
          ) : scheduler.data?.jobs.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduler.data.jobs.slice(0, 8).map((job, index) => (
                  <TableRow key={job.id || `${job.name}-${index}`}>
                    <TableCell className="pl-5 font-medium text-slate-900">
                      {job.name}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={String(job.status ?? "")} />
                    </TableCell>
                    <TableCell className="pr-5 text-xs text-slate-500">
                      {formatDate(job.startedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="No scheduler jobs returned"
              detail="The configured RunMyJobs endpoint returned an empty collection for this request."
            />
          )}
        </Card>
        <Card>
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-950">
              Connector health
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Server-side test status, never inferred from sample data
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {data?.integrations.map((item) => (
              <button
                key={item.id}
                className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
                onClick={onOpenSettings}
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {item.displayName}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.environment} ·{" "}
                    {item.lastTestedAt
                      ? formatDate(item.lastTestedAt)
                      : "Never tested"}
                  </p>
                </div>
                <StatusBadge status={item.status} />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export function LiveDashboard({
  heading,
  businessDate,
  environment,
  onOpenSettings,
  onOpenJobs,
  onOpenFiles,
  onOpenValidations,
}: {
  heading: ReactNode;
  businessDate: string;
  environment: string;
  onOpenSettings: () => void;
  onOpenJobs: () => void;
  onOpenFiles: () => void;
  onOpenValidations: (group: "Scheduled" | "Unscheduled") => void;
}) {
  const overview = useApi<Overview>(
    `/api/operations/overview?environment=${encodeURIComponent(environment)}`,
  );
  const localConnector = useApi<LocalConnectorConfig>(
    `http://localhost:8788/local-bes/config?environment=${encodeURIComponent(environment)}`,
  );
  const scheduled = useApi<{ jobs: CatalogJob[] }>(
    `/api/jobs?kind=ALL&businessDate=${encodeURIComponent(businessDate)}`,
  );
  const [open, setOpen] = useState<"daily" | "special" | "all" | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const jobs = scheduled.data?.jobs ?? [];
  const local = environment === "LOCAL";
  const dailyJobs = jobs.filter((job) => job.definitionKind === "DAILY");
  const specialJobs = jobs.filter((job) => job.definitionKind === "SPECIAL");
  const daily = dailyJobs.length;
  const special = specialJobs.length;
  const data = overview.data;
  const healthIntegrations = useMemo(() => {
    const connectorHealth = localConnector.data?.connectionHealth ?? {};
    return (data?.integrations ?? []).map((item) => {
      const localKey = item.id.startsWith("rmj-")
        ? "rmj"
        : item.id.startsWith("gcp-logging-")
          ? "cloud-logs"
          : item.id.startsWith("gcs-")
            ? "gcs"
            : item.id.startsWith("oracle-")
              ? "oracle"
              : item.id.startsWith("mongodb-")
                ? "mongo"
                : "";
      return localKey && connectorHealth[localKey]
        ? { ...item, status: "CONNECTED", lastTestedAt: undefined }
        : item;
    });
  }, [data?.integrations, localConnector.data?.connectionHealth]);
  const connectedConnectorCount = healthIntegrations.filter(
    (item) => item.status === "CONNECTED",
  ).length;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>{heading}</div>
        <Button
          variant="outline"
          onClick={() => {
            overview.reload();
            scheduled.reload();
            localConnector.reload();
          }}
        >
          <RefreshCw className="size-4" />
          Refresh dashboard
        </Button>
      </div>
      <div className="studio-dashboard-grid">
        <section className="studio-due-panel studio-light" aria-labelledby="schedule-overview-title">
          <div className="studio-panel-heading">
            <span className="studio-panel-icon"><CalendarDays aria-hidden="true" /></span>
            <h2 id="schedule-overview-title">Jobs due today</h2>
            <span className="studio-context-pill">Selected date</span>
            <button className="studio-circle-button" onClick={() => setOpen("all")} aria-label="View all jobs due on the selected date"><ArrowUpRight aria-hidden="true" /></button>
          </div>
          <div className="studio-due-content">
            <div className="studio-due-total">
              <p className="studio-giant-number">{scheduled.loading ? "…" : scheduled.error ? "—" : jobs.length.toLocaleString()}</p>
              <p className="studio-total-caption">Scheduled jobs</p>
              <span className="studio-dot-field" aria-hidden="true" />
            </div>
            <div className="studio-due-breakdown">
              <button className="studio-count-tile" onClick={() => setOpen("daily")}>
                <span><span className="studio-small-heading">Daily jobs</span><strong>{scheduled.loading ? "…" : scheduled.error ? "—" : daily.toLocaleString()}</strong></span>
                <CalendarDays aria-hidden="true" />
              </button>
              <button className="studio-count-tile" onClick={() => setOpen("special")}>
                <span><span className="studio-small-heading">Special jobs</span><strong>{scheduled.loading ? "…" : scheduled.error ? "—" : special.toLocaleString()}</strong></span>
                <Activity aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="studio-due-footer">
            <span><CalendarDays className="size-4" aria-hidden="true" />{businessDate}</span>
            <button className="studio-dark-button" onClick={() => setOpen("all")}>View all jobs<ArrowUpRight className="size-4" aria-hidden="true" /></button>
          </div>
        </section>
        <section className="studio-connection-summary" aria-labelledby="connection-summary-title">
          <span className="studio-plug-icon"><Plug aria-hidden="true" /></span>
          <div>
            <h2 id="connection-summary-title">Connection status</h2>
            <p>{overview.loading ? "Checking connections…" : overview.error ? "Status unavailable" : `${connectedConnectorCount} of ${data?.metrics.totalIntegrations ?? 0} connectors configured`}</p>
            <small>{local ? "Local BES" : environment.replace(/^(NP_|PROD_)/, "")} · Current environment</small>
          </div>
          <button className="studio-circle-button" onClick={onOpenSettings} aria-label="Manage connection settings"><ArrowUpRight aria-hidden="true" /></button>
        </section>
        <section className="studio-validation-panel" aria-labelledby="validation-overview-title">
          <div className="studio-panel-heading">
            <span className="studio-panel-icon"><ShieldCheck aria-hidden="true" /></span>
            <h2 id="validation-overview-title">Pre &amp; Post Validations</h2>
          </div>
          <p className="studio-validation-count"><strong>{overview.loading ? "…" : overview.error ? "—" : (data?.metrics.validationRuns ?? 0).toLocaleString()}</strong><span>Recorded validation runs</span></p>
          <div className="studio-validation-links">
            <button onClick={() => onOpenValidations("Scheduled")}><FileSpreadsheet aria-hidden="true" /><span><strong>Scheduled</strong><small>View checks</small></span><ArrowUpRight className="studio-link-arrow" aria-hidden="true" /></button>
            <button onClick={() => onOpenValidations("Unscheduled")}><Clock3 aria-hidden="true" /><span><strong>Unscheduled</strong><small>View checks</small></span><ArrowUpRight className="studio-link-arrow" aria-hidden="true" /></button>
          </div>
        </section>
        <Card className="studio-schedule-card studio-light">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">
                Scheduled jobs
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Daily and Special workbook schedule · {businessDate}
              </p>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen("all")}
                disabled={!jobs.length}
              >
                <Eye className="size-4" />
                View all
              </Button>
              <Button variant="ghost" size="sm" onClick={onOpenJobs}>
                Open jobs
              </Button>
            </div>
          </div>
          {scheduled.loading ? (
            <Busy />
          ) : scheduled.error ? (
            <EmptyState
              title="Schedule is unavailable"
              detail={scheduled.error}
            />
          ) : jobs.length ? (
            <Table className="studio-schedule-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Job</TableHead>
                  <TableHead>Group / schedule</TableHead>
                  <TableHead className="pr-5">Validation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.slice(0, 8).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="pl-5">
                      <p className="studio-job-name font-medium text-slate-900">
                        {job.jobName}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {job.definitionKind}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {job.schedule || "Not mapped"}
                    </TableCell>
                    <TableCell className="pr-5 text-xs text-slate-600">
                      {job.hasPreValidation || job.hasPostValidation
                        ? "Pre/Post available"
                        : "Not mapped"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="No jobs are scheduled"
              detail="No Daily or Special workbook rows match the selected business date."
            />
          )}
        </Card>
        <Card className="ops-connector-card studio-light">
          <div className="ops-connector-heading border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Connector health</h2>
              <p className="mt-0.5 text-xs text-slate-500">Your selected environment</p>
            </div>
            <span className="ops-connector-count">{connectedConnectorCount}<span> / {data?.metrics.totalIntegrations ?? 0}</span></span>
          </div>
          <div className="divide-y divide-slate-100">
            {healthIntegrations.map((item) => (
              <button
                key={item.id}
                className="ops-connector-row flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
                onClick={onOpenSettings}
              >
                <span className={`ops-connector-symbol ${item.status === "CONNECTED" ? "is-connected" : ""}`} aria-hidden="true"><Server className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    {item.displayName}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.environment} ·{" "}
                    {item.status === "CONNECTED"
                      ? "Configured on this computer"
                      : item.lastTestedAt
                        ? formatDate(item.lastTestedAt)
                        : "Not configured"}
                  </p>
                </div>
                <StatusBadge status={item.status} />
              </button>
            ))}
          </div>
          {overview.loading && <Busy />}
          {overview.error && <p className="px-5 py-4 text-sm" role="status">Connection status is unavailable. Refresh to try again.</p>}
          <div className="studio-connector-footer">
            <button className="studio-dark-button" onClick={onOpenSettings}>Manage connections<ArrowUpRight className="size-4" aria-hidden="true" /></button>
          </div>
        </Card>
      </div>
      <section className="studio-resource-strip" aria-label="Report tools and workbook sources">
        <div className="studio-resource-label"><FileSpreadsheet aria-hidden="true" /><div><h2>Files &amp; reports</h2><p>View, download, export CSV, and analyze your files</p></div></div>
        <button className="studio-soft-button" onClick={() => setSourceOpen(true)}><FileSpreadsheet className="size-4" aria-hidden="true" />Workbook sources{data && <span className="studio-inline-count">{data.metrics.activeWorkbookSources.toLocaleString()}</span>}</button>
        <button className="studio-coral-button" onClick={onOpenFiles}>Open reports<ArrowUpRight className="size-4" aria-hidden="true" /></button>
      </section>
      <Dialog
        open={open != null}
        onOpenChange={(visible) => {
          if (!visible) setOpen(null);
        }}
      >
        <DialogContent className="grid h-[min(88vh,900px)] w-[min(96vw,1240px)] max-w-none grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-3xl border-0 bg-slate-50 p-0 shadow-2xl">
          <DialogHeader className="border-b border-slate-200 bg-gradient-to-r from-slate-950 to-slate-800 p-7 text-white">
            <DialogTitle>
              {jobs.length.toLocaleString()} jobs due on {businessDate}
            </DialogTitle>
            <DialogDescription className="text-slate-300">
              Daily and Special workbook rows matching the selected business
              date. Rows are not deduplicated.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-auto p-6">
            <Tabs
              defaultValue={
                open === "all"
                  ? "all"
                  : open === "special"
                    ? "special"
                    : "daily"
              }
              key={open}
            >
              <TabsList className="grid w-full max-w-xl grid-cols-3 rounded-xl bg-slate-200 p-1">
                <TabsTrigger value="all" className="rounded-lg">
                  All jobs ({jobs.length})
                </TabsTrigger>
                <TabsTrigger value="daily" className="rounded-lg">
                  Daily jobs ({daily})
                </TabsTrigger>
                <TabsTrigger value="special" className="rounded-lg">
                  Special jobs ({special})
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="all"
                className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <ScheduledJobsTable jobs={jobs} />
              </TabsContent>
              <TabsContent
                value="daily"
                className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <ScheduledJobsTable jobs={dailyJobs} />
              </TabsContent>
              <TabsContent
                value="special"
                className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <ScheduledJobsTable jobs={specialJobs} />
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter className="border-t border-slate-200 bg-white p-5">
            <Button onClick={() => setOpen(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent className="w-[min(94vw,900px)] max-w-none overflow-hidden rounded-3xl border-0 bg-slate-50 p-0 shadow-2xl">
          <DialogHeader className="border-b border-slate-200 bg-gradient-to-r from-violet-700 to-indigo-700 p-7 text-white">
            <DialogTitle>Active workbook sources</DialogTitle>
            <DialogDescription className="text-violet-100">
              The currently active upload used to build schedules and validation
              queries.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-auto p-6">
            <div className="grid gap-4 sm:grid-cols-3">
              {(data?.activeImports ?? []).map((source) => (
                <div
                  key={`${source.kind}-${source.filename}`}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <Badge variant="outline" className="mb-3">
                    {source.kind}
                  </Badge>
                  <p className="break-words text-sm font-semibold text-slate-900">
                    {source.filename}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {source.rowCount.toLocaleString()} rows
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Imported {formatDate(source.uploadedAt)}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="border-t border-slate-200 bg-white p-5">
            <Button onClick={() => setSourceOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

void DashboardLegacy;

function rawField(rawJson: string | undefined, candidates: string[]) {
  try {
    const raw = JSON.parse(rawJson || "{}") as Record<string, unknown>;
    const entry = Object.entries(raw).find(([key]) =>
      candidates.includes(key.toLowerCase().replace(/[^a-z0-9]/g, "")),
    );
    return entry?.[1] == null ? "" : String(entry[1]);
  } catch {
    return "";
  }
}

export function LiveJobs({
  heading,
  businessDate,
  initialQuery,
  environment,
  onOpenSettings,
}: {
  heading: ReactNode;
  businessDate: string;
  initialQuery: string;
  environment: string;
  onOpenSettings: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);
  const [kind, setKind] = useState("ALL");
  const [selectedDueJobId, setSelectedDueJobId] = useState<string | null>(null);
  const catalog = useApi<{ jobs: CatalogJob[] }>(
    `/api/jobs?q=${encodeURIComponent(deferredQuery)}&kind=${kind}&businessDate=${encodeURIComponent(businessDate)}`,
  );
  const scheduler = useApi<{ jobs: SchedulerJob[]; fetchedAt: string }>(
    `http://localhost:8788/local-bes/rmj/jobs?environment=${encodeURIComponent(environment)}&businessDate=${encodeURIComponent(businessDate)}&q=${encodeURIComponent(deferredQuery)}`,
  );
  const rmjImportInput = useRef<HTMLInputElement>(null);
  const [pendingRmjExport, setPendingRmjExport] =
    useState<ImportedRmjExport | null>(null);
  const [importedRmjExport, setImportedRmjExport] =
    useState<ImportedRmjExport | null>(null);
  const rmjExportStorageKey = `bes-rmj-export-${environment.toUpperCase()}`;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(rmjExportStorageKey);
        setImportedRmjExport(
          saved ? (JSON.parse(saved) as ImportedRmjExport) : null,
        );
      } catch {
        setImportedRmjExport(null);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [rmjExportStorageKey]);

  const visibleSchedulerJobs = useMemo(() => {
    const jobs = importedRmjExport?.jobs ?? scheduler.data?.jobs ?? [];
    const search = deferredQuery.trim().toLowerCase();
    if (!search || !importedRmjExport) return jobs;
    return jobs.filter((job) =>
      [job.name, job.definition, job.status, job.queue, job.server]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search)),
    );
  }, [deferredQuery, importedRmjExport, scheduler.data?.jobs]);
  const schedulerUnavailable = importedRmjExport ? "" : (scheduler.error ?? "");
  const dueJobs = catalog.data?.jobs ?? [];
  const selectedDueJob = dueJobs.find((job) => job.id === selectedDueJobId);

  async function chooseRmjExport(file?: File) {
    if (!file) return;
    try {
      setPendingRmjExport(await parseRmjExport(file));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to read the RMJ export.",
      );
    } finally {
      if (rmjImportInput.current) rmjImportInput.current.value = "";
    }
  }

  function applyRmjExport() {
    if (!pendingRmjExport) return;
    setImportedRmjExport(pendingRmjExport);
    window.localStorage.setItem(
      rmjExportStorageKey,
      JSON.stringify(pendingRmjExport),
    );
    toast.success(
      `${pendingRmjExport.jobs.length.toLocaleString()} RMJ jobs imported.`,
    );
    setPendingRmjExport(null);
  }

  function clearRmjExport() {
    window.localStorage.removeItem(rmjExportStorageKey);
    setImportedRmjExport(null);
    toast.message("Imported RMJ export cleared.");
  }

  function openRmjSearch(jobName?: string) {
    window.open(RMJ_DEV_URL, "_blank", "noopener,noreferrer");
    if (!jobName) return;
    void navigator.clipboard
      .writeText(jobName)
      .then(() =>
        toast.success(
          "RMJ opened. The job name was copied: paste it into Search Chain Definitions.",
        ),
      )
      .catch(() => toast.message(`RMJ opened. Search for: ${jobName}`));
  }
  return (
    <div className="space-y-6">
      <input
        ref={rmjImportInput}
        type="file"
        accept=".csv,.xls,.xlsx"
        className="hidden"
        onChange={(event) => void chooseRmjExport(event.target.files?.[0])}
      />
      <div>{heading}</div>
      <Card>
        <Tabs defaultValue="due">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
            <TabsList>
              <TabsTrigger value="due">Jobs due today</TabsTrigger>
              <TabsTrigger value="scheduler">RMJ executions</TabsTrigger>
              <TabsTrigger value="catalog">All imported jobs</TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-64 flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search job name"
                  className="pl-9"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => rmjImportInput.current?.click()}
              >
                <Upload className="size-4" />
                Import RMJ export
              </Button>
              <Button
                variant="outline"
                disabled={!selectedDueJob}
                onClick={() => openRmjSearch(selectedDueJob?.jobName)}
              >
                <Copy className="size-4" />
                Open selected in RMJ
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh jobs"
                onClick={() => {
                  scheduler.reload();
                  catalog.reload();
                }}
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
          </div>
          <TabsContent value="due" className="m-0">
            <div className="flex flex-col gap-2 border-b border-cyan-100 bg-cyan-50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-cyan-950">
                  Workbook jobs due on {businessDate}
                </p>
                <p className="mt-0.5 text-xs text-cyan-800">
                  Select one job, then open RMJ. Its exact RMJ job name is
                  copied for the Search Chain Definitions box.
                </p>
              </div>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="h-8 w-40 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Daily and special</SelectItem>
                  <SelectItem value="DAILY">Daily jobs</SelectItem>
                  <SelectItem value="SPECIAL">Special jobs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {catalog.loading ? (
              <Busy />
            ) : catalog.error ? (
              <EmptyState
                title="Jobs due are unavailable"
                detail={catalog.error}
              />
            ) : dueJobs.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 pl-5">Select</TableHead>
                      <TableHead>RMJ job name</TableHead>
                      <TableHead>Workbook job</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Validation</TableHead>
                      <TableHead className="pr-5 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dueJobs.map((job) => {
                      const selected = job.id === selectedDueJobId;
                      return (
                        <TableRow
                          key={job.id}
                          data-state={selected ? "selected" : undefined}
                        >
                          <TableCell className="pl-5">
                            <Checkbox
                              aria-label={`Select ${job.jobName}`}
                              checked={selected}
                              onCheckedChange={(checked) =>
                                setSelectedDueJobId(checked ? job.id : null)
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <p className="font-medium text-slate-900">
                              {job.jobName}
                            </p>
                            <p className="mt-0.5 max-w-80 truncate text-xs text-slate-500">
                              {job.description ||
                                job.comment ||
                                "No workbook note"}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {job.definitionKind}
                            </Badge>
                            {job.displayJobName !== job.jobName && (
                              <p className="mt-1 max-w-52 truncate text-xs text-slate-500">
                                {job.displayJobName}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {job.schedule || "Scheduled"}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {job.hasPreValidation || job.hasPostValidation
                              ? "Pre/Post available"
                              : "Not mapped"}
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedDueJobId(job.id);
                                openRmjSearch(job.jobName);
                              }}
                            >
                              <Copy className="size-3.5" />
                              Find in RMJ
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState
                title="No workbook jobs are due"
                detail="No active Daily or Special workbook rows match the selected business date."
              />
            )}
          </TabsContent>
          <TabsContent value="scheduler" className="m-0">
            {importedRmjExport && (
              <div className="flex flex-col gap-3 border-b border-cyan-100 bg-cyan-50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-cyan-900">
                    Using imported RMJ export
                  </p>
                  <p className="mt-0.5 text-xs text-cyan-800">
                    {importedRmjExport.filename} ·{" "}
                    {importedRmjExport.jobs.length.toLocaleString()} jobs ·
                    imported {formatDate(importedRmjExport.importedAt)}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={clearRmjExport}>
                  Clear imported export
                </Button>
              </div>
            )}
            {scheduler.loading && !importedRmjExport ? (
              <Busy />
            ) : schedulerUnavailable ? (
              <EmptyState
                title="RunMyJobs is not ready"
                detail={schedulerUnavailable}
                action={
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => rmjImportInput.current?.click()}
                    >
                      <Upload className="size-4" />
                      Import RMJ export
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onOpenSettings}
                    >
                      Configure RunMyJobs
                    </Button>
                  </div>
                }
              />
            ) : visibleSchedulerJobs.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Job</TableHead>
                    <TableHead>Definition</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Queue / server</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>RMJ</TableHead>
                    <TableHead className="pr-5">Ended</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleSchedulerJobs.map((job, index) => (
                    <TableRow key={job.id || `${job.name}-${index}`}>
                      <TableCell className="pl-5">
                        <p className="font-medium text-slate-900">{job.name}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                          {job.id || "ID not reported"}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {String(job.definition ?? "Not reported")}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={String(job.status ?? "")} />
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {String(job.queue ?? job.server ?? "Not reported")}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {formatDate(job.startedAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => openRmjSearch(job.name)}
                        >
                          <Copy className="size-3.5" />
                          Find job
                        </Button>
                      </TableCell>
                      <TableCell className="pr-5 text-xs text-slate-500">
                        {formatDate(job.endedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="No RMJ jobs available"
                detail="Import a CSV/XLSX export from RunMyJobs, or configure the live API connection."
                action={
                  <Button
                    size="sm"
                    onClick={() => rmjImportInput.current?.click()}
                  >
                    <Upload className="size-4" />
                    Import RMJ export
                  </Button>
                }
              />
            )}
          </TabsContent>
          <TabsContent value="catalog" className="m-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-xs text-slate-500">
                Workbook rows are configuration only. They are never presented
                as execution status.
              </p>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All catalogs</SelectItem>
                  <SelectItem value="DAILY">Daily jobs</SelectItem>
                  <SelectItem value="SPECIAL">Special jobs</SelectItem>
                  <SelectItem value="VALIDATION">Pre/Post queries</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {catalog.loading ? (
              <Busy />
            ) : catalog.error ? (
              <EmptyState title="Catalog unavailable" detail={catalog.error} />
            ) : catalog.data?.jobs.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Job</TableHead>
                    <TableHead>Catalog</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Validation</TableHead>
                    <TableHead className="pr-5">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalog.data.jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="pl-5">
                        <p className="font-medium text-slate-900">
                          {job.jobName}
                        </p>
                        <p className="mt-0.5 max-w-80 truncate text-xs text-slate-500">
                          {job.description ||
                            job.comment ||
                            "No description in workbook"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{job.definitionKind}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {rawField(job.rawJson, [
                          "schedule",
                          "time",
                          "starttime",
                          "runtime",
                          "frequency",
                        ]) || "Not mapped"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {job.preValidation || job.postValidation
                          ? "Pre/Post available"
                          : "None mapped"}
                      </TableCell>
                      <TableCell className="pr-5 font-mono text-[10px] text-slate-400">
                        {job.sourceImportId}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="No imported jobs"
                detail="Upload a Daily, Special, or Pre/Post workbook in Excel Management."
              />
            )}
          </TabsContent>
        </Tabs>
      </Card>
      <Dialog
        open={Boolean(pendingRmjExport)}
        onOpenChange={(open) => !open && setPendingRmjExport(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Review RMJ export</DialogTitle>
            <DialogDescription>
              Import job status from a RunMyJobs CSV or Excel export. This file
              is saved only in this browser for the selected environment.
            </DialogDescription>
          </DialogHeader>
          {pendingRmjExport && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    File
                  </p>
                  <p className="mt-1 break-all text-sm font-medium text-slate-900">
                    {pendingRmjExport.filename}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Jobs detected
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {pendingRmjExport.jobs.length.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Columns detected
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {pendingRmjExport.columns.length}
                  </p>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-800">
                  Detected columns
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {pendingRmjExport.columns.slice(0, 16).map((column) => (
                    <Badge
                      key={column}
                      variant="outline"
                      className="font-normal"
                    >
                      {column}
                    </Badge>
                  ))}
                  {pendingRmjExport.columns.length > 16 && (
                    <Badge variant="outline" className="font-normal">
                      +{pendingRmjExport.columns.length - 16} more
                    </Badge>
                  )}
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Queue / server</TableHead>
                      <TableHead>Started</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingRmjExport.jobs.slice(0, 5).map((job, index) => (
                      <TableRow key={job.id || `${job.name}-${index}`}>
                        <TableCell className="font-medium text-slate-900">
                          {job.name}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={String(job.status ?? "")} />
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {String(job.queue ?? job.server ?? "Not reported")}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {formatDate(job.startedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRmjExport(null)}>
              Cancel
            </Button>
            <Button
              className="bg-cyan-700 text-white hover:bg-cyan-800"
              onClick={applyRmjExport}
            >
              <Upload className="size-4" />
              Import jobs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function LiveValidations({
  heading,
  businessDate,
  environment,
  initialGroup = "Scheduled",
}: {
  heading: ReactNode;
  businessDate: string;
  environment: string;
  initialGroup?: "Scheduled" | "Unscheduled";
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [running, setRunning] = useState<string | null>(null);
  const [review, setReview] = useState<{
    item: Validation;
    phase: "PRE" | "POST";
  } | null>(null);
  const [editingSqlQuery, setEditingSqlQuery] = useState("");
  const [editingMongoQuery, setEditingMongoQuery] = useState("");
  const [editorType, setEditorType] = useState<"SQL" | "MONGO">("SQL");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedScheduleGroups, setExpandedScheduleGroups] = useState<
    Set<string>
  >(new Set([initialGroup]));
  const validations = useApi<{ validations: Validation[] }>(
    `/api/validations?q=${encodeURIComponent(deferredQuery)}&businessDate=${encodeURIComponent(businessDate)}`,
  );
  const groupedValidations = useMemo(() => {
    const items = validations.data?.validations ?? [];
    return [
      { group: "Scheduled", items: items.filter((item) => item.isScheduled) },
      {
        group: "Unscheduled",
        items: items.filter((item) => !item.isScheduled),
      },
    ];
  }, [validations.data?.validations]);
  const toggleScheduleGroup = (group: string) =>
    setExpandedScheduleGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  const sqlCheck = useMemo(
    () => checkReadOnlySql(editingSqlQuery),
    [editingSqlQuery],
  );
  const mongoSafe =
    !/\b(insert|update|delete|remove|drop|create|rename|bulkWrite|replaceOne|replaceMany|findOneAndUpdate|findOneAndDelete|\$out|\$merge)\b/i.test(
      editingMongoQuery,
    );

  async function openReview(item: Validation, phase: "PRE" | "POST") {
    setReviewLoading(true);
    setReview({ item, phase });
    setEditingSqlQuery("");
    setEditingMongoQuery("");
    setEditorType("SQL");
    try {
      const response = await fetch(
        `/api/validations/${encodeURIComponent(item.id)}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as {
        validation?: {
          preValidation?: string;
          postValidation?: string;
          preMongoValidation?: string;
          postMongoValidation?: string;
        };
        error?: string;
      };
      if (!response.ok || !result.validation)
        throw new Error(result.error ?? "Unable to load the saved query.");
      setEditingSqlQuery(
        phase === "PRE"
          ? (result.validation.preValidation ?? "")
          : (result.validation.postValidation ?? ""),
      );
      setEditingMongoQuery(
        phase === "PRE"
          ? (result.validation.preMongoValidation ?? "")
          : (result.validation.postMongoValidation ?? ""),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load the saved query.",
      );
      setReview(null);
    } finally {
      setReviewLoading(false);
    }
  }

  async function saveQuery(queryType = editorType) {
    if (!review) return;
    const activeQuery =
      queryType === "SQL" ? editingSqlQuery : editingMongoQuery;
    if (queryType === "SQL" && !sqlCheck.safe) {
      toast.error(sqlCheck.message);
      return;
    }
    if (queryType === "MONGO" && !mongoSafe) {
      toast.error("MongoDB query must be read-only.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        `/api/validations/${encodeURIComponent(review.item.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phase: review.phase,
            query: activeQuery,
            queryType,
          }),
        },
      );
      const result = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Unable to save query.");
      toast.success(result.message ?? "Query saved.");
      validations.reload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save query.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function run(
    item: Validation,
    phase: "PRE" | "POST",
    queryType: "SQL" | "MONGO",
  ) {
    setRunning(`${item.id}-${phase}-${queryType}`);
    try {
      const saved = await fetch(
        `/api/validations/${encodeURIComponent(item.id)}`,
        { cache: "no-store" },
      );
      const catalog = (await saved.json()) as {
        validation?: {
          preValidation?: string;
          postValidation?: string;
          preMongoValidation?: string;
          postMongoValidation?: string;
        };
        error?: string;
      };
      if (!saved.ok || !catalog.validation)
        throw new Error(
          catalog.error ?? "Unable to load the saved validation query.",
        );
      const mongoQuery =
        phase === "PRE"
          ? catalog.validation.preMongoValidation
          : catalog.validation.postMongoValidation;
      const sqlQuery =
        phase === "PRE"
          ? catalog.validation.preValidation
          : catalog.validation.postValidation;
      const selectedQuery = queryType === "MONGO" ? mongoQuery : sqlQuery;
      if (!selectedQuery?.trim())
        throw new Error(
          `${phase} ${queryType === "MONGO" ? "MongoDB" : "SQL"} query is not configured.`,
        );
      const response = await fetch(
        "http://localhost:8788/local-bes/validation",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobName: item.jobName,
            phase,
            businessDate,
            environment,
            queryType,
            query: selectedQuery,
          }),
        },
      );
      const result = (await response.json()) as {
        message?: string;
        error?: string;
        resultCount?: number | null;
      };
      if (!response.ok)
        throw new Error(result.error ?? result.message ?? "Validation failed.");
      toast.success(
        `${phase} validation completed${result.resultCount == null ? "" : ` with ${result.resultCount.toLocaleString()} rows`}`,
      );
      await fetch("/api/validations/local-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: item.id,
          phase,
          queryType,
          resultCount: result.resultCount ?? null,
          message: result.message ?? "Validation completed.",
        }),
      });
      validations.reload();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Local connector is not running or the selected environment is not reachable through VPN.",
      );
      if (environment !== "LOCAL") validations.reload();
    } finally {
      setRunning(null);
    }
  }
  return (
    <div className="space-y-6">
      <div>{heading}</div>
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search imported validation jobs"
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={validations.reload}>
            <RefreshCw className="size-4" />
            Refresh results
          </Button>
        </div>
        {validations.loading ? (
          <Busy />
        ) : validations.error ? (
          <EmptyState
            title="Validation catalog unavailable"
            detail={validations.error}
          />
        ) : validations.data?.validations.length ? (
          <div className="divide-y divide-slate-100">
            {groupedValidations.map(({ group, items }) => {
              const expanded = expandedScheduleGroups.has(group);
              return (
                <section key={group}>
                  <button
                    type="button"
                    className="ops-validation-group flex w-full items-center justify-between gap-4 bg-slate-50 px-5 py-4 text-left hover:bg-slate-100"
                    aria-expanded={expanded}
                    onClick={() => toggleScheduleGroup(group)}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <ChevronRight
                        className={`size-4 text-slate-500 transition-transform ${expanded ? "rotate-90" : ""}`}
                      />
                      {group}
                    </span>
                    <Badge variant="outline" className="rounded-full">
                      {items.length} {items.length === 1 ? "job" : "jobs"}
                    </Badge>
                  </button>
                  {expanded && (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="pl-5">Job</TableHead>
                            <TableHead>Workbook schedule</TableHead>
                            <TableHead>Pre query</TableHead>
                            <TableHead>Mongo pre</TableHead>
                            <TableHead>SQL pre</TableHead>
                            <TableHead>Pre total</TableHead>
                            <TableHead>Post query</TableHead>
                            <TableHead>Mongo post</TableHead>
                            <TableHead>SQL post</TableHead>
                            <TableHead>Post total</TableHead>
                            <TableHead>Last real run</TableHead>
                            <TableHead className="pr-5 text-right">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {!items.length && (
                            <TableRow>
                              <TableCell
                                colSpan={12}
                                className="py-8 text-center text-sm text-slate-500"
                              >
                                No validation jobs are in this list for the
                                selected business date.
                              </TableCell>
                            </TableRow>
                          )}
                          {items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="pl-5">
                                <p className="font-medium text-slate-900">
                                  {item.jobName}
                                </p>
                                <p className="mt-0.5 max-w-72 truncate text-xs text-slate-500">
                                  {item.comment ||
                                    item.description ||
                                    "No workbook note"}
                                </p>
                              </TableCell>
                              <TableCell className="text-xs text-slate-600">
                                {item.scheduleGroup || "Not mapped"}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <StatusBadge
                                    status={
                                      item.preValidation ||
                                      item.hasPreMongoValidation
                                        ? "READY"
                                        : "NOT_CONFIGURED"
                                    }
                                  />
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={
                                      !item.preValidation &&
                                      !item.hasPreMongoValidation
                                    }
                                    onClick={() => void openReview(item, "PRE")}
                                  >
                                    <Eye className="size-3.5" />
                                    Review
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell>
                                {item.preMongoResultCount == null ? (
                                  <span className="text-xs text-slate-400">
                                    Not run
                                  </span>
                                ) : (
                                  <span className="font-mono text-sm font-semibold text-emerald-700">
                                    {item.preMongoResultCount.toLocaleString()}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                {item.preSqlResultCount == null ? (
                                  <span className="text-xs text-slate-400">
                                    Not run
                                  </span>
                                ) : (
                                  <span className="font-mono text-sm font-semibold text-emerald-700">
                                    {item.preSqlResultCount.toLocaleString()}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                {item.preResultCount == null ? (
                                  <span className="text-xs text-slate-400">
                                    Not run
                                  </span>
                                ) : (
                                  <span className="font-mono text-sm font-bold text-slate-900">
                                    {item.preResultCount.toLocaleString()}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <StatusBadge
                                    status={
                                      item.postValidation ||
                                      item.hasPostMongoValidation
                                        ? "READY"
                                        : "NOT_CONFIGURED"
                                    }
                                  />
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={
                                      !item.postValidation &&
                                      !item.hasPostMongoValidation
                                    }
                                    onClick={() =>
                                      void openReview(item, "POST")
                                    }
                                  >
                                    <Eye className="size-3.5" />
                                    Review
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell>
                                {item.postMongoResultCount == null ? (
                                  <span className="text-xs text-slate-400">
                                    Not run
                                  </span>
                                ) : (
                                  <span className="font-mono text-sm font-semibold text-emerald-700">
                                    {item.postMongoResultCount.toLocaleString()}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                {item.postSqlResultCount == null ? (
                                  <span className="text-xs text-slate-400">
                                    Not run
                                  </span>
                                ) : (
                                  <span className="font-mono text-sm font-semibold text-emerald-700">
                                    {item.postSqlResultCount.toLocaleString()}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                {item.postResultCount == null ? (
                                  <span className="text-xs text-slate-400">
                                    Not run
                                  </span>
                                ) : (
                                  <span className="font-mono text-sm font-bold text-slate-900">
                                    {item.postResultCount.toLocaleString()}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col items-start gap-1">
                                  <StatusBadge status={item.lastStatus} />
                                  <span className="text-[10px] text-slate-400">
                                    {item.lastExecutedAt
                                      ? formatDate(item.lastExecutedAt)
                                      : "Never executed"}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="pr-5">
                                <div className="grid min-w-[340px] grid-cols-2 gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      !item.hasPreMongoValidation ||
                                      running != null
                                    }
                                    onClick={() =>
                                      void run(item, "PRE", "MONGO")
                                    }
                                  >
                                    {running === `${item.id}-PRE-MONGO` ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Play className="size-3.5" />
                                    )}
                                    Mongo pre count
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      !item.preValidation || running != null
                                    }
                                    onClick={() => void run(item, "PRE", "SQL")}
                                  >
                                    {running === `${item.id}-PRE-SQL` ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Play className="size-3.5" />
                                    )}
                                    SQL pre count
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      !item.hasPostMongoValidation ||
                                      running != null
                                    }
                                    onClick={() =>
                                      void run(item, "POST", "MONGO")
                                    }
                                  >
                                    {running === `${item.id}-POST-MONGO` ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Play className="size-3.5" />
                                    )}
                                    Mongo post count
                                  </Button>
                                  <Button
                                    size="sm"
                                    disabled={
                                      !item.postValidation || running != null
                                    }
                                    onClick={() =>
                                      void run(item, "POST", "SQL")
                                    }
                                  >
                                    {running === `${item.id}-POST-SQL` ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Play className="size-3.5" />
                                    )}
                                    SQL post count
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No imported validation jobs"
            detail="Upload a Pre/Post validation workbook in Excel Management to add validation definitions."
          />
        )}
      </Card>
      <Dialog
        open={review != null}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
      >
        <DialogContent className="grid h-[calc(100vh-4rem)] w-[calc(100vw-3rem)] max-w-none grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-3xl border-0 bg-slate-50 p-0 shadow-2xl sm:!max-w-none xl:h-[min(92vh,1080px)] xl:w-[min(96vw,1500px)]">
          <DialogHeader className="border-b border-slate-200 bg-white px-7 py-5">
            <div className="flex flex-wrap items-center gap-2 pr-8">
              <DialogTitle>{review?.phase} query review</DialogTitle>
              <Badge
                variant="outline"
                className="border-cyan-200 bg-cyan-50 text-cyan-800"
              >
                Executing in {environment.replace(/^(NP_|PROD_)/, "")}
              </Badge>
            </div>
            <DialogDescription>
              Maintain separate read-only SQL and MongoDB queries for{" "}
              {review?.item.jobName}. Save either editor, then run the matching
              query directly through the selected environment profile. The
              environment shown above is the connection profile used when you
              select Save and run.
            </DialogDescription>
          </DialogHeader>
          {reviewLoading ? (
            <Busy />
          ) : (
            <div className="min-h-0 space-y-3 overflow-y-auto px-7 py-5">
              <Tabs
                value={editorType}
                onValueChange={(value) =>
                  setEditorType(value as "SQL" | "MONGO")
                }
              >
                <TabsList>
                  <TabsTrigger value="SQL">SQL editor</TabsTrigger>
                  <TabsTrigger value="MONGO">MongoDB editor</TabsTrigger>
                </TabsList>
                <TabsContent value="SQL" className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={sqlCheck.safe ? "READY" : "WARNING"} />
                    <span
                      className={`text-xs ${sqlCheck.safe ? "text-emerald-700" : "text-amber-700"}`}
                    >
                      {sqlCheck.message}
                    </span>
                  </div>
                  <Textarea
                    value={editingSqlQuery}
                    onChange={(event) => setEditingSqlQuery(event.target.value)}
                    spellCheck={false}
                    className="min-h-[62vh] w-full resize-y font-mono text-sm leading-6"
                    aria-label="Validation SQL query"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setEditingSqlQuery(safeSqlCleanup(editingSqlQuery))
                      }
                    >
                      <WandSparkles className="size-4" />
                      Safe cleanup
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setEditingSqlQuery(formatSql(editingSqlQuery))
                      }
                    >
                      <WandSparkles className="size-4" />
                      Format SQL
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="MONGO" className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={mongoSafe ? "READY" : "WARNING"} />
                    <span
                      className={`text-xs ${mongoSafe ? "text-emerald-700" : "text-amber-700"}`}
                    >
                      {mongoSafe
                        ? "Read-only MongoDB query"
                        : "MongoDB write operations are blocked"}
                    </span>
                  </div>
                  <Textarea
                    value={editingMongoQuery}
                    onChange={(event) =>
                      setEditingMongoQuery(event.target.value)
                    }
                    spellCheck={false}
                    className="min-h-[62vh] w-full resize-y font-mono text-sm leading-6"
                    aria-label="Validation MongoDB query"
                    placeholder="db.collection.find({}).toArray()"
                  />
                  <p className="text-xs text-slate-500">
                    Use a read-only MongoDB expression, for example{" "}
                    <code>{"db.collection.find({}).toArray()"}</code> or{" "}
                    <code>{"db.collection.countDocuments({})"}</code>.
                  </p>
                </TabsContent>
              </Tabs>
            </div>
          )}
          <DialogFooter className="border-t border-slate-200 bg-white px-7 py-4">
            <Button variant="outline" onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={
                reviewLoading ||
                saving ||
                running != null ||
                (editorType === "SQL" ? !sqlCheck.safe : !mongoSafe)
              }
              onClick={async () => {
                await saveQuery();
                if (review) await run(review.item, review.phase, editorType);
              }}
            >
              <Play className="size-4" />
              Save and run {editorType === "SQL" ? "SQL" : "MongoDB"}
            </Button>
            <Button
              disabled={
                reviewLoading ||
                saving ||
                (editorType === "SQL" ? !sqlCheck.safe : !mongoSafe)
              }
              onClick={() => void saveQuery()}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save {review?.phase} {editorType === "SQL" ? "SQL" : "MongoDB"}{" "}
              query
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function LivePerformance({ heading }: { heading: ReactNode }) {
  const overview = useApi<Overview>("/api/operations/overview");
  const stats = overview.data?.validationStats ?? [];
  const total = stats.reduce((sum, item) => sum + Number(item.count), 0);
  const success = stats
    .filter((item) =>
      ["SUCCESS", "SUCCEEDED"].includes(item.status.toUpperCase()),
    )
    .reduce((sum, item) => sum + Number(item.count), 0);
  const failed = stats
    .filter((item) => ["FAILED", "ERROR"].includes(item.status.toUpperCase()))
    .reduce((sum, item) => sum + Number(item.count), 0);
  const durations =
    overview.data?.recentRuns
      .map((item) => item.durationMs)
      .filter((item): item is number => typeof item === "number") ?? [];
  const average = durations.length
    ? Math.round(
        durations.reduce((sum, value) => sum + value, 0) / durations.length,
      )
    : 0;
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>{heading}</div>
        <Button variant="outline" onClick={overview.reload}>
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </div>
      {overview.error && <ErrorNotice message={overview.error} />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Recorded runs"
          value={total.toLocaleString()}
          detail="All persisted validation executions"
          icon={History}
          tone="bg-slate-100 text-slate-700"
        />
        <Metric
          label="Success rate"
          value={total ? `${Math.round((success / total) * 100)}%` : "No data"}
          detail="Calculated only from stored outcomes"
          icon={CheckCircle2}
          tone="bg-emerald-50 text-emerald-700"
        />
        <Metric
          label="Average duration"
          value={durations.length ? `${average} ms` : "No data"}
          detail="Recent measured gateway duration"
          icon={Gauge}
          tone="bg-cyan-50 text-cyan-700"
        />
        <Metric
          label="Failed runs"
          value={failed.toLocaleString()}
          detail="Real failed execution records"
          icon={AlertTriangle}
          tone="bg-rose-50 text-rose-700"
        />
      </div>
      <Card>
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-950">
            Outcome distribution
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            No synthetic baseline or forecast is included
          </p>
        </div>
        {overview.loading ? (
          <Busy />
        ) : stats.length ? (
          <div className="space-y-4 p-5">
            {stats.map((item) => {
              const percentage = total
                ? Math.round((Number(item.count) / total) * 100)
                : 0;
              return (
                <div key={item.status}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <StatusBadge status={item.status} />
                    <span className="text-xs text-slate-500">
                      {item.count} runs · {percentage}%
                      {item.averageDurationMs != null
                        ? ` · ${Math.round(item.averageDurationMs)} ms avg`
                        : ""}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-cyan-600"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No performance data yet"
            detail="Performance appears after real validation execution attempts are recorded."
          />
        )}
      </Card>
    </div>
  );
}

export function LiveHistory({ heading }: { heading: ReactNode }) {
  const [query, setQuery] = useState("");
  const overview = useApi<Overview>("/api/operations/overview");
  const rows = useMemo(
    () =>
      (overview.data?.recentRuns ?? []).filter((item) =>
        `${item.jobName} ${item.id} ${item.correlationId ?? ""} ${item.status}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [overview.data, query],
  );
  return (
    <div className="space-y-6">
      <div>{heading}</div>
      <Card>
        <div className="flex gap-2 border-b border-slate-100 p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search job, run ID, status, or correlation ID"
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="icon" onClick={overview.reload}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
        {overview.loading ? (
          <Busy />
        ) : overview.error ? (
          <EmptyState
            title="Execution history unavailable"
            detail={overview.error}
          />
        ) : rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Executed</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5">Correlation ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="pl-5 text-xs text-slate-500">
                    {formatDate(run.executedAt)}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium text-slate-900">{run.jobName}</p>
                    <p className="mt-0.5 max-w-64 truncate text-xs text-slate-500">
                      {run.message}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{run.phase}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {run.durationMs == null
                      ? "Not recorded"
                      : `${run.durationMs} ms`}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {run.resultCount ?? "Not reported"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="pr-5 font-mono text-[10px] text-slate-400">
                    {run.correlationId || "Not recorded"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No execution history"
            detail="Real validation attempts will appear here. RunMyJobs history is shown in Today’s Jobs after its endpoint is configured."
          />
        )}
      </Card>
    </div>
  );
}

export function LiveAudit({ heading }: { heading: ReactNode }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const audit = useApi<{ events: AuditEvent[] }>(
    `/api/audit?q=${encodeURIComponent(deferredQuery)}`,
  );
  return (
    <div className="space-y-6">
      <div>{heading}</div>
      <Card>
        <div className="flex gap-2 border-b border-slate-100 p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search action, target, or correlation ID"
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="icon" onClick={audit.reload}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
        {audit.loading ? (
          <Busy />
        ) : audit.error ? (
          <EmptyState title="Audit trail unavailable" detail={audit.error} />
        ) : audit.data?.events.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Connector / target</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="pr-5">Correlation ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.data.events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="pl-5 text-xs text-slate-500">
                    {formatDate(event.occurredAt)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {event.actorId}
                  </TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {event.eventType.replaceAll("_", " ")}
                  </TableCell>
                  <TableCell>
                    <p className="text-xs text-slate-700">
                      {event.integration} · {event.environment}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                      {event.targetId}
                    </p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={event.result} />
                  </TableCell>
                  <TableCell className="pr-5 font-mono text-[10px] text-slate-400">
                    {event.correlationId}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No audit events"
            detail="Configuration changes, connector tests, scheduler reads, GCS operations, log searches, and validations are recorded here when executed."
          />
        )}
      </Card>
    </div>
  );
}
