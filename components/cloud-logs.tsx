"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertTriangle,
  Braces,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  type LucideIcon,
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type LogEntry = {
  timestamp?: string;
  severity: string;
  projectId: string;
  namespace: string;
  microservice: string;
  pod: string;
  container: string;
  message: string;
  trace: string;
  spanId: string;
  logName: string;
  insertId: string;
  jsonPayload: Record<string, unknown>;
};

type Options = {
  projects: Array<{ id: string; namespaces: string[] }>;
  microservices: string[];
  resourceType: string;
  retentionDays: number | null;
  connectorStatus: string;
  lastTestedAt: string | null;
};

type LogSummary = {
  total: number;
  error: number;
  warning: number;
  info: number;
  debug: number;
};

const TIME_ZONES = [
  { value: "BROWSER", label: "Browser local time" },
  { value: "UTC", label: "UTC" },
  { value: "America/Los_Angeles", label: "Pacific time" },
  { value: "Pacific/Honolulu", label: "Hawaii time" },
] as const;

const APPROVED_MICROSERVICES = [
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

function environmentNamespace(environment: string) {
  return environment.replace(/^(NP_|PROD_)/, "").toLowerCase();
}

function localDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function zonedDateTime(date: Date, timeZone: string) {
  if (timeZone === "BROWSER") return localDateTime(date);
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: string) =>
    values.find((item) => item.type === name)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function zonedInputDate(value: string, timeZone: string) {
  if (timeZone === "BROWSER") return new Date(value);
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = (datePart || "").split("-").map(Number);
  const [hour, minute] = (timePart || "").split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite))
    return new Date("invalid");
  const expected = Date.UTC(year, month - 1, day, hour, minute);
  let instant = expected;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const zoned = zonedDateTime(new Date(instant), timeZone);
    const [zonedDate, zonedTime] = zoned.split("T");
    const [zonedYear, zonedMonth, zonedDay] = zonedDate.split("-").map(Number);
    const [zonedHour, zonedMinute] = zonedTime.split(":").map(Number);
    instant +=
      expected -
      Date.UTC(zonedYear, zonedMonth - 1, zonedDay, zonedHour, zonedMinute);
  }
  return new Date(instant);
}

function displayTimestamp(value: string | undefined, timeZone: string) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString(undefined, {
    ...(timeZone === "BROWSER" ? {} : { timeZone }),
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function likelyCause(message: string) {
  const text = message
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/ORA-\d+/i.test(text))
    return "Oracle database error reported by the service.";
  if (/timeout|timed out/i.test(text))
    return "The downstream request exceeded its timeout.";
  if (/unauthorized|forbidden|401|403/i.test(text))
    return "Authentication or authorization was rejected.";
  if (/connection refused|connectexception|unknown host/i.test(text))
    return "The service could not reach a downstream endpoint.";
  if (/exception|error|failed/i.test(text)) return text.slice(0, 420);
  return "Open the complete entry to review the service message and trace ID.";
}

function statusTone(status: string) {
  if (status === "CONNECTED")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "DEGRADED")
    return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "FAILED") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function severityTone(severity: string) {
  if (["ERROR", "CRITICAL", "ALERT", "EMERGENCY"].includes(severity))
    return "border-rose-200 bg-rose-50 text-rose-700";
  if (severity === "WARNING")
    return "border-amber-200 bg-amber-50 text-amber-700";
  if (["DEBUG", "DEFAULT"].includes(severity))
    return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-cyan-200 bg-cyan-50 text-cyan-700";
}

export default function CloudLogs({
  heading,
  environment,
  onOpenSettings,
}: {
  heading: ReactNode;
  environment: string;
  onOpenSettings: () => void;
}) {
  const [mode, setMode] = useState("search");
  const [options, setOptions] = useState<Options | null>(null);
  const [projectId, setProjectId] = useState("bes-np");
  const [namespace, setNamespace] = useState(() =>
    environmentNamespace(environment),
  );
  const [microservice, setMicroservice] = useState("bes-int-cons");
  const [severity, setSeverity] = useState("ALL");
  const [timeZone, setTimeZone] = useState("BROWSER");
  const [message, setMessage] = useState("");
  const [jobId, setJobId] = useState("");
  const [traceId, setTraceId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [from, setFrom] = useState(() =>
    localDateTime(new Date(Date.now() - 15 * 60_000)),
  );
  const [to, setTo] = useState(() => localDateTime(new Date()));
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<LogSummary | null>(null);
  const [capped, setCapped] = useState(false);
  const [exactCounts, setExactCounts] = useState(false);
  const [sourceScope, setSourceScope] = useState("LOADED_PAGE");
  const [entrySeverity, setEntrySeverity] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [diagnostic, setDiagnostic] = useState<{
    message: string;
    category?: string;
    correlationId?: string;
  } | null>(null);
  const newestRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const selectedNamespace = environmentNamespace(environment);
    void fetch(
      `http://localhost:8788/local-bes/config?environment=${encodeURIComponent(environment)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          config?: { gcsProject?: string };
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            payload.error ?? "Unable to contact the local connector.",
          );
        const project = payload.config?.gcsProject?.trim() || "bes-np";
        const localOptions: Options = {
          projects: [{ id: project, namespaces: [selectedNamespace] }],
          microservices: [...APPROVED_MICROSERVICES],
          resourceType: "k8s_container",
          retentionDays: null,
          connectorStatus: "LOCAL_GCLOUD",
          lastTestedAt: null,
        };
        setNamespace(selectedNamespace);
        setEntries([]);
        setSummary(null);
        setDiagnostic(null);
        setOptions(localOptions);
        setProjectId(project);
        setMicroservice((current) =>
          localOptions.microservices.includes(current)
            ? current
            : (localOptions.microservices[0] ?? ""),
        );
      })
      .catch((error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to load log options.",
        ),
      );
  }, [environment]);

  const namespaces = useMemo(
    () =>
      options?.projects.find((project) => project.id === projectId)
        ?.namespaces ?? [],
    [options, projectId],
  );

  const searchLogs = useCallback(
    async (
      append = false,
      liveRequest = false,
      requestedSeverity = severity,
    ) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setLoading(true);
      setDiagnostic(null);
      try {
        const response = await fetch("http://localhost:8788/local-bes/logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            environment,
            projectId,
            namespace,
            microservice,
            severity: requestedSeverity,
            message,
            jobId,
            traceId,
            sessionId,
            from:
              liveRequest && newestRef.current
                ? newestRef.current
                : zonedInputDate(from, timeZone).toISOString(),
            to: liveRequest
              ? new Date().toISOString()
              : zonedInputDate(to, timeZone).toISOString(),
            pageSize: 100,
          }),
        });
        const payload = (await response.json()) as {
          entries?: LogEntry[];
          summary?: LogSummary;
          fetched?: number;
          capped?: boolean;
          exactCounts?: boolean;
          sourceScope?: string;
          nextPageToken?: string | null;
          error?: string;
          category?: string;
          correlationId?: string;
        };
        if (!response.ok)
          throw Object.assign(
            new Error(payload.error ?? "Cloud Logging search failed."),
            {
              category: payload.category,
              correlationId: payload.correlationId,
            },
          );
        const nextEntries = payload.entries ?? [];
        if (liveRequest) {
          setEntries((current) => {
            const seen = new Set(
              current.map(
                (entry) =>
                  entry.insertId || `${entry.timestamp}-${entry.message}`,
              ),
            );
            return [
              ...nextEntries.filter(
                (entry) =>
                  !seen.has(
                    entry.insertId || `${entry.timestamp}-${entry.message}`,
                  ),
              ),
              ...current,
            ].slice(0, 500);
          });
        } else
          setEntries((current) =>
            append ? [...current, ...nextEntries] : nextEntries,
          );
        if (!liveRequest) {
          setSummary(payload.summary ?? null);
          setCapped(Boolean(payload.capped));
          setExactCounts(Boolean(payload.exactCounts));
          setSourceScope(payload.sourceScope ?? "LOADED_PAGE");
        }
        const newest = nextEntries[0]?.timestamp;
        if (newest) newestRef.current = newest;
      } catch (error) {
        const typed = error as Error & {
          category?: string;
          correlationId?: string;
        };
        setDiagnostic({
          message: typed.message,
          category: typed.category,
          correlationId: typed.correlationId,
        });
        if (liveRequest) setLive(false);
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [
      environment,
      from,
      jobId,
      message,
      microservice,
      namespace,
      projectId,
      sessionId,
      severity,
      timeZone,
      to,
      traceId,
    ],
  );

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void searchLogs(false, true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [live, searchLogs]);

  function quickRange(minutes: number) {
    const end = new Date();
    setTo(zonedDateTime(end, timeZone));
    setFrom(
      zonedDateTime(new Date(end.getTime() - minutes * 60_000), timeZone),
    );
  }

  const counts =
    summary ??
    (() => ({
      total: entries.length,
      error: entries.filter((entry) =>
        ["ERROR", "CRITICAL", "ALERT", "EMERGENCY"].includes(entry.severity),
      ).length,
      warning: entries.filter((entry) => entry.severity === "WARNING").length,
      info: entries.filter(
        (entry) => entry.severity === "INFO" || entry.severity === "NOTICE",
      ).length,
      debug: entries.filter(
        (entry) => entry.severity === "DEBUG" || entry.severity === "DEFAULT",
      ).length,
    }))();

  const visibleEntries = useMemo(
    () =>
      entrySeverity === "ALL"
        ? entries
        : entries.filter((entry) => {
            if (entrySeverity === "ERROR")
              return ["ERROR", "CRITICAL", "ALERT", "EMERGENCY"].includes(
                entry.severity,
              );
            if (entrySeverity === "INFO")
              return ["INFO", "NOTICE"].includes(entry.severity);
            return entry.severity === entrySeverity;
          }),
    [entries, entrySeverity],
  );

  function changeTimeZone(nextTimeZone: string) {
    const fromInstant = zonedInputDate(from, timeZone);
    const toInstant = zonedInputDate(to, timeZone);
    setTimeZone(nextTimeZone);
    if (!Number.isNaN(fromInstant.getTime()))
      setFrom(zonedDateTime(fromInstant, nextTimeZone));
    if (!Number.isNaN(toInstant.getTime()))
      setTo(zonedDateTime(toInstant, nextTimeZone));
  }

  function openGoogleLogsExplorer() {
    const filter = [
      `resource.labels.namespace_name="${namespace}"`,
      `labels."k8s-pod/app"="${microservice}"`,
      severity !== "ALL" ? `severity>=${severity}` : "",
      message.trim()
        ? `textPayload:"${message.trim().replaceAll('"', '\\"')}"`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const url = `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(filter)}?project=${encodeURIComponent(projectId)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>{heading}</div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={statusTone(options?.connectorStatus ?? "NOT_CONFIGURED")}
          >
            {(options?.connectorStatus ?? "NOT_CONFIGURED").replaceAll(
              "_",
              " ",
            )}
          </Badge>
          <Button variant="outline" onClick={onOpenSettings}>
            Integration settings
          </Button>
          <Button variant="outline" onClick={openGoogleLogsExplorer}>
            <ExternalLink className="size-4" />
            Open Logs Explorer
          </Button>
        </div>
      </div>

      <section className="ops-surface overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-4 xl:flex-row xl:items-center xl:justify-between">
          <Tabs
            value={mode}
            onValueChange={(value) => {
              setMode(value);
              setLive(false);
            }}
          >
            <TabsList>
              <TabsTrigger value="search">
                <Search className="size-3.5" />
                Historical search
              </TabsTrigger>
              <TabsTrigger value="live">
                <Activity className="size-3.5" />
                Live monitor
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {[5, 15, 60, 360, 1440].map((minutes) => (
              <Button
                key={minutes}
                variant="ghost"
                size="sm"
                onClick={() => quickRange(minutes)}
              >
                {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Project
            <Select
              value={projectId}
              onValueChange={(next) => {
                setProjectId(next);
                const first = options?.projects.find(
                  (project) => project.id === next,
                )?.namespaces[0];
                if (first) setNamespace(first);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options?.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Namespace
            <Select value={namespace} onValueChange={setNamespace}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {namespaces.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Microservice
            <Select value={microservice} onValueChange={setMicroservice}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options?.microservices.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Severity
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["ALL", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map(
                  (item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            From
            <Input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            To
            <Input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Time zone
            <Select value={timeZone} onValueChange={changeTimeZone}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_ZONES.map((zone) => (
                  <SelectItem key={zone.value} value={zone.value}>
                    {zone.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600 xl:col-span-2">
            Message contains
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="pl-9"
                placeholder="Search log message"
              />
            </div>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Job ID
            <Input
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Trace ID
            <Input
              value={traceId}
              onChange={(event) => setTraceId(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Session ID
            <Input
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <div className="flex items-end gap-2 xl:col-span-2">
            {mode === "live" ? (
              <Button
                className={
                  live
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : "bg-cyan-700 text-white hover:bg-cyan-800"
                }
                onClick={() => {
                  if (!live) {
                    setLive(true);
                    void searchLogs(false, true);
                  } else setLive(false);
                }}
              >
                {live ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
                {live ? "Stop live" : "Start live"}
              </Button>
            ) : (
              <Button
                className="bg-cyan-700 text-white hover:bg-cyan-800"
                onClick={() => void searchLogs()}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                Search logs
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh logs"
              onClick={() => void searchLogs()}
              disabled={loading}
            >
              <RefreshCw
                className={`size-4 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            [
              "Errors",
              counts.error,
              ShieldAlert,
              "border-rose-200 bg-rose-50 text-rose-700",
            ],
            [
              "Warnings",
              counts.warning,
              AlertTriangle,
              "border-amber-200 bg-amber-50 text-amber-700",
            ],
            [
              "Info",
              counts.info,
              Activity,
              "border-cyan-200 bg-cyan-50 text-cyan-700",
            ],
            [
              "Debug",
              counts.debug,
              Braces,
              "border-slate-200 bg-slate-50 text-slate-600",
            ],
          ] satisfies Array<[string, number, LucideIcon, string]>
        ).map(([label, value, Icon, tone]) => (
          <button
            key={label}
            type="button"
            className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${tone}`}
            onClick={() => {
              const selectedSeverity =
                label === "Errors"
                  ? "ERROR"
                  : label === "Warnings"
                    ? "WARNING"
                    : label === "Info"
                      ? "INFO"
                      : "DEBUG";
              setEntrySeverity((current) =>
                current === selectedSeverity ? "ALL" : selectedSeverity,
              );
            }}
            aria-label={`View ${label.toLowerCase()} logs`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider">
                {label}
              </span>
              <Icon className="size-4" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-950">
              {value.toLocaleString()}
            </p>
            <p className="mt-1 text-[11px] font-medium opacity-75">
              {entrySeverity ===
              (label === "Errors"
                ? "ERROR"
                : label === "Warnings"
                  ? "WARNING"
                  : label === "Info"
                    ? "INFO"
                    : "DEBUG")
                ? "Show all loaded logs"
                : `View loaded ${label.toLowerCase()}`}
            </p>
          </button>
        ))}
      </div>

      {diagnostic && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-5 text-rose-600" />
            <div>
              <p className="font-semibold text-rose-900">
                {diagnostic.category?.replaceAll("_", " ") ??
                  "Connection blocked"}
              </p>
              <p className="mt-1 text-sm text-rose-800">{diagnostic.message}</p>
              {diagnostic.correlationId && (
                <p className="mt-2 font-mono text-[11px] text-rose-700">
                  Correlation: {diagnostic.correlationId}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="ops-surface overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">
              Log entries
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {summary?.total
                ? exactCounts
                  ? `${summary.total.toLocaleString()} exact matching logs across the selected time range`
                  : `${summary.total.toLocaleString()} loaded logs counted, showing ${visibleEntries.length.toLocaleString()} ${entrySeverity === "ALL" ? "newest" : entrySeverity.toLowerCase()} entries`
                : "No cached or sample entries are shown"}
              {capped
                ? " This is a fast page of recent results, not a complete range total."
                : ""}
              {!exactCounts && summary?.total
                ? " Configure an approved exact-count analytics source in Settings when one is provided."
                : ""}
              {sourceScope === "FULL_RANGE_ANALYTICS"
                ? " Source: approved full-range analytics."
                : ""}
            </p>
          </div>
          {live && (
            <Badge className="gap-1.5 bg-emerald-600">
              <span className="size-1.5 animate-pulse rounded-full bg-white" />
              Live every 5s
            </Badge>
          )}
        </div>
        {visibleEntries.length ? (
          <div className="divide-y divide-slate-100">
            {visibleEntries.map((entry, index) => (
              <button
                key={entry.insertId || `${entry.timestamp}-${index}`}
                className="grid w-full gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50 lg:grid-cols-[155px_92px_1fr_180px_28px] lg:items-start"
                onClick={() => setSelected(entry)}
              >
                <span className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
                  <Clock3 className="size-3.5" />
                  {displayTimestamp(entry.timestamp, timeZone)}
                </span>
                <Badge
                  variant="outline"
                  className={`w-fit ${severityTone(entry.severity)}`}
                >
                  {entry.severity}
                </Badge>
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm leading-5 text-slate-800">
                    {entry.message || "No message payload"}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-slate-400">
                    {entry.pod || "Unknown pod"} ·{" "}
                    {entry.container || "Unknown container"}
                  </span>
                </span>
                <span className="flex items-center gap-2 truncate text-xs text-slate-500">
                  <Server className="size-3.5" />
                  {entry.namespace}/{entry.microservice}
                </span>
                <ChevronRight className="size-4 text-slate-300" />
              </button>
            ))}
          </div>
        ) : (
          <div className="grid min-h-60 place-items-center p-8 text-center">
            <div>
              <Search className="mx-auto size-9 text-slate-300" />
              <p className="mt-3 font-medium text-slate-800">
                No real log results loaded
              </p>
              <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
                Sign in with your company Google Cloud account on this computer,
                then search the environment namespace and service. VPN is not
                required for Cloud Logging.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={onOpenSettings}
              >
                Open integration settings
              </Button>
            </div>
          </div>
        )}
      </section>

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-3xl">
          <SheetHeader className="border-b border-slate-100 p-6">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={severityTone(selected?.severity ?? "DEFAULT")}
              >
                {selected?.severity}
              </Badge>
              <Badge variant="outline">
                {selected?.namespace}/{selected?.microservice}
              </Badge>
            </div>
            <SheetTitle className="mt-3">Cloud Logging entry</SheetTitle>
            <SheetDescription>
              {displayTimestamp(selected?.timestamp, timeZone)}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="space-y-5 p-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800">
                {selected.message}
              </div>
              {["ERROR", "CRITICAL", "ALERT", "EMERGENCY", "WARNING"].includes(
                selected.severity,
              ) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                    Likely cause
                  </p>
                  <p className="mt-1 text-sm leading-6 text-amber-950">
                    {likelyCause(selected.message)}
                  </p>
                </div>
              )}
              <dl className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Pod", selected.pod],
                  ["Container", selected.container],
                  ["Trace", selected.trace],
                  ["Insert ID", selected.insertId],
                  ["Log name", selected.logName],
                  ["Span ID", selected.spanId],
                ].map(([label, value]) => (
                  <div key={label} className="border-b border-slate-100 pb-3">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {label}
                    </dt>
                    <dd className="mt-1 break-all font-mono text-xs text-slate-700">
                      {value || "Not present"}
                    </dd>
                  </div>
                ))}
              </dl>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Formatted JSON payload
                </p>
                <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-cyan-100">
                  {JSON.stringify(selected.jsonPayload, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
