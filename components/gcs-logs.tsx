"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Download,
  Eye,
  FileCode2,
  FileSearch,
  FileSpreadsheet,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type GcsObject = {
  name: string;
  size?: string;
  timeCreated?: string;
  updated?: string;
  contentType?: string;
  md5Hash?: string;
  storageClass?: string;
};

type ListResponse = {
  project?: string;
  bucket?: string;
  prefix?: string;
  items?: GcsObject[];
  folderPrefixes?: string[];
  nextPageToken?: string | null;
  authenticated?: boolean;
  authMode?: string;
  totalBytes?: number;
  allowDownload?: boolean;
  scannedCount?: number;
  scanTruncated?: boolean;
  initialFolderBrowse?: boolean;
  code?: string;
  error?: string;
};

type ReportAnalysis = {
  name: string;
  reportType: "run" | "control" | "other";
  recordCount: number | null;
  processedCount: number | null;
  declaredTotal?: number | null;
  parsedRecords?: number | null;
  uniqueCaseIds?: number | null;
  successfulRecords?: number | null;
  errorCount: number;
  warningCount: number;
  nullCount: number;
  mismatches?: number | null;
  observations: Array<{ label: string; count: number; detail: string }>;
  summary: string;
  truncated?: boolean;
};

type Severity = "ALL" | "ERROR" | "WARNING" | "INFO" | "DEBUG";

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value?: string) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function cleanObjectName(name: string) {
  return String(name || "").replace(/#\d+$/, "");
}

function isTextPreview(name: string) {
  return /\.(?:txt|log|csv|json|xml|yaml|yml|sql|out|err)$/i.test(name);
}

function reportRecordType(name: string) {
  const normalized = cleanObjectName(name).replace(/[_-]+/g, " ").toLowerCase();
  if (/\bcontrol\s*report\b/.test(normalized)) return "Control report";
  if (/\brun\s*report\b/.test(normalized)) return "Run report";
  return "Report";
}

function reportFileName(name: string) {
  return cleanObjectName(name).split("/").pop() || "Unnamed report";
}

function severityFor(line: string): Exclude<Severity, "ALL"> {
  const upper = line.toUpperCase();
  if (/\b(ERROR|FATAL|SEVERE|EXCEPTION|FAILED)\b/.test(upper)) return "ERROR";
  if (/\b(WARN|WARNING)\b/.test(upper)) return "WARNING";
  if (/\b(DEBUG|TRACE)\b/.test(upper)) return "DEBUG";
  return "INFO";
}

const severityTone: Record<Exclude<Severity, "ALL">, string> = {
  ERROR: "border-rose-200 bg-rose-50 text-rose-700",
  WARNING: "border-amber-200 bg-amber-50 text-amber-700",
  INFO: "border-cyan-200 bg-cyan-50 text-cyan-700",
  DEBUG: "border-violet-200 bg-violet-50 text-violet-700",
};

export default function GcsLogs({
  heading,
  businessDate,
  environment,
  scope,
  onOpenSettings,
}: {
  heading: ReactNode;
  businessDate: string;
  environment: string;
  scope: "reports" | "transfers";
  onOpenSettings: () => void;
}) {
  const localMode = true;
  const [objects, setObjects] = useState<GcsObject[]>([]);
  const [folderOptions, setFolderOptions] = useState<string[]>([]);
  const [bucket, setBucket] = useState("");
  const [resolvedPrefix, setResolvedPrefix] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState("");
  const [totalBytes, setTotalBytes] = useState(0);
  const [allowDownload, setAllowDownload] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [scanTruncated, setScanTruncated] = useState(false);
  const [initialFolderBrowse, setInitialFolderBrowse] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(
    null,
  );
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [prefix, setPrefix] = useState("");
  const [fromDate, setFromDate] = useState(localMode ? "" : businessDate);
  const [toDate, setToDate] = useState(localMode ? "" : businessDate);
  const [fileType, setFileType] = useState(localMode ? "all" : "logs");
  const [pageToken, setPageToken] = useState("");
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [tokenHistory, setTokenHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<GcsObject | null>(null);
  const [content, setContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [contentTruncated, setContentTruncated] = useState(false);
  const [analysis, setAnalysis] = useState<ReportAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [viewerQuery, setViewerQuery] = useState("");
  const [severity, setSeverity] = useState<Severity>("ALL");
  const [transferArea, setTransferArea] = useState<"inbound" | "outbound">(
    "inbound",
  );
  const [sortBy, setSortBy] = useState<"updated" | "created" | "name" | "size">(
    "updated",
  );
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const effectiveScope = scope === "transfers" ? transferArea : scope;

  const environmentFolder = environment.trim().toUpperCase() || "LOCAL";
  const rootPrefix = scope === "reports"
    ? `BatchControlReport/${environmentFolder}/`
    : `${effectiveScope === "outbound" ? "OUTBOUND" : "INBOUND"}/${environmentFolder}/`;

  async function loadObjects(
    token = "",
    resetHistory = false,
    prefixOverride?: string,
    merge = false,
    forceRefresh = false,
  ) {
    if (!merge) setLoading(true);
    setError(null);
    try {
      const activePrefix = prefixOverride ?? prefix;
      const params = new URLSearchParams({
        q: query,
        prefix: activePrefix,
        from: fromDate,
        to: toDate,
        type: fileType,
        limit: localMode ? "1000" : "50",
      });
      if (localMode) {
        params.set("scope", effectiveScope);
      }
      if (forceRefresh) params.set("refresh", "1");
      if (token) params.set("pageToken", token);
      const response = await fetch(
        `http://localhost:8788/local-bes/gcs?${params.toString()}&environment=${encodeURIComponent(environment)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as ListResponse;
      if (!response.ok) {
        setObjects([]);
        setAuthenticated(false);
        setAllowDownload(false);
        setScannedCount(0);
        setScanTruncated(false);
        setInitialFolderBrowse(false);
        setNextPageToken(null);
        setError({
          code: payload.code,
          message: payload.error ?? "Unable to read GCS logs.",
        });
        return;
      }
      setObjects((current) =>
        merge
          ? Array.from(
              new Map(
                [...current, ...(payload.items ?? [])].map((item) => [
                  item.name,
                  item,
                ]),
              ).values(),
            )
          : (payload.items ?? []),
      );
      setBucket(payload.bucket ?? "");
      setFolderOptions(payload.folderPrefixes ?? []);
      setResolvedPrefix(payload.prefix ?? "");
      setAuthenticated(Boolean(payload.authenticated));
      setAuthMode(payload.authMode ?? "");
      setTotalBytes(payload.totalBytes ?? 0);
      setAllowDownload(Boolean(payload.allowDownload));
      setScannedCount(payload.scannedCount ?? payload.items?.length ?? 0);
      setScanTruncated(Boolean(payload.scanTruncated));
      setInitialFolderBrowse(Boolean(payload.initialFolderBrowse));
      setNextPageToken(payload.nextPageToken ?? null);
      setPageToken(token);
      if (resetHistory) setTokenHistory([]);
      setLastSync(new Date());
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Unable to read GCS logs.";
      setError({ message });
      setObjects([]);
      setAuthenticated(false);
      setAllowDownload(false);
      setScannedCount(0);
      setScanTruncated(false);
      setInitialFolderBrowse(false);
      setNextPageToken(null);
    } finally {
      if (!merge) setLoading(false);
    }
  }

  useEffect(() => {
    setPrefix(rootPrefix);
    const timer = window.setTimeout(
      () => void loadObjects("", true, rootPrefix),
      0,
    );
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveScope, environment, scope]);

  async function openLog(item: GcsObject) {
    const name = cleanObjectName(item.name);
    if (!isTextPreview(name)) {
      window.open(
        `http://localhost:8788/local-bes/gcs?name=${encodeURIComponent(name)}&view=1&environment=${encodeURIComponent(environment)}`,
        "_blank",
        "noopener,noreferrer",
      );
      toast.message("Opening the original file in a new tab.");
      return;
    }
    setSelected(item);
    setContent("");
    setViewerQuery("");
    setSeverity("ALL");
    setContentLoading(true);
    try {
      const response = await fetch(
        `http://localhost:8788/local-bes/gcs?name=${encodeURIComponent(name)}&environment=${encodeURIComponent(environment)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        content?: string;
        truncated?: boolean;
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to open this GCS object.");
      setContent(payload.content ?? "");
      setContentTruncated(Boolean(payload.truncated));
    } catch (openError) {
      toast.error(
        openError instanceof Error
          ? openError.message
          : "Unable to open this GCS object.",
      );
      setSelected(null);
    } finally {
      setContentLoading(false);
    }
  }

  async function analyzeReport(item: GcsObject) {
    setAnalysis(null);
    setAnalysisLoading(true);
    try {
      const response = await fetch(
        `http://localhost:8788/local-bes/gcs?name=${encodeURIComponent(cleanObjectName(item.name))}&analyze=1&environment=${encodeURIComponent(environment)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as ReportAnalysis & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to analyze this report.");
      setAnalysis(payload);
    } catch (analysisError) {
      toast.error(
        analysisError instanceof Error
          ? analysisError.message
          : "Unable to analyze this report.",
      );
    } finally {
      setAnalysisLoading(false);
    }
  }

  const logLines = useMemo(
    () =>
      content
        .split(/\r?\n/)
        .map((line, index) => ({
          index: index + 1,
          line,
          severity: severityFor(line),
        }))
        .filter((entry) => {
          if (severity !== "ALL" && entry.severity !== severity) return false;
          return (
            !viewerQuery ||
            entry.line.toLowerCase().includes(viewerQuery.toLowerCase())
          );
        }),
    [content, severity, viewerQuery],
  );

  const severityCounts = useMemo(
    () =>
      content.split(/\r?\n/).reduce<Record<string, number>>((counts, line) => {
        const value = severityFor(line);
        counts[value] = (counts[value] ?? 0) + 1;
        return counts;
      }, {}),
    [content],
  );

  const filteredContentBlob = useMemo(() => {
    const text = logLines.map(l => l.line).join("\n");
    return new Blob([text], { type: "text/plain" });
  }, [logLines]);

  const handleDownloadSelected = () => {
    const url = URL.createObjectURL(filteredContentBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `filtered_${selected?.name.split("/").pop()}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const latest = objects.find((item) => item.updated)?.updated;

  function useBusinessDate() {
    setFromDate(businessDate);
    setToDate(businessDate);
  }

  async function nextPage() {
    if (!nextPageToken) return;
    setTokenHistory((history) => [...history, pageToken]);
    await loadObjects(nextPageToken);
  }

  async function previousPage() {
    const previous = tokenHistory[tokenHistory.length - 1] ?? "";
    setTokenHistory((history) => history.slice(0, -1));
    await loadObjects(previous);
  }

  const canGoBack = prefix.length > rootPrefix.length && prefix.startsWith(rootPrefix);

  const handleBack = () => {
    if (!canGoBack) return;
    const segments = prefix.replace(/\/$/, "").split("/");
    segments.pop();
    const nextPrefix = segments.length ? segments.join("/") + "/" : "";
    const finalPrefix = nextPrefix.length < rootPrefix.length ? rootPrefix : nextPrefix;
    setPrefix(finalPrefix);
    void loadObjects("", true, finalPrefix);
  };

  const downloadUrl = (name: string) =>
    `http://localhost:8788/local-bes/gcs?name=${encodeURIComponent(cleanObjectName(name))}&download=1&environment=${encodeURIComponent(environment)}`;
    
  const openGcsConsole = () => {
    const isLocalEnvironment = environmentFolder === "LOCAL";
    const isProductionEnvironment = ["UAT1", "PROD_TIM3", "PER1", "STG1"].includes(environmentFolder);
    const activePrefix = prefix || resolvedPrefix.split(",")[0]?.trim() || rootPrefix;
    const consoleBucket = isLocalEnvironment ? bucket || "dhs-bes-np-gcs-intcons-to-process-local" : "dhs-bes-np-gcs-intcons-to-process";
    const consoleProject = isProductionEnvironment ? "bes-prd" : "bes-np";
    const url = new URL(`https://console.cloud.google.com/storage/browser/${encodeURIComponent(consoleBucket)}`);
    if (activePrefix) url.searchParams.set("prefix", activePrefix);
    url.searchParams.set("project", consoleProject);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="space-y-6"
      data-gcs-downloads={allowDownload ? "true" : "false"}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>{heading}</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openGcsConsole}>
            <Cloud className="size-4" />
            {scope === "reports" ? "Open Reports GCS" : "Open GCS bucket"}
          </Button>
          <Button variant="outline" onClick={onOpenSettings}>
            <Settings2 className="size-4" />
            GCS settings
          </Button>
          <Button
            className="bg-cyan-700 text-white hover:bg-cyan-800"
            onClick={() =>
              void loadObjects(pageToken, false, undefined, false, true)
            }
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh files
          </Button>
        </div>
      </div>

      <section className="ops-source-banner overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-white shadow-xl">
        <div className="grid gap-5 p-5 lg:grid-cols-[1.3fr_.7fr] lg:p-6">
          <div className="flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-300/20">
              <Cloud className="size-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">
                  Google Cloud Storage file browser
                </h2>
                <Badge
                  variant="outline"
                  className={
                    authenticated
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                      : "border-amber-400/30 bg-amber-400/10 text-amber-300"
                  }
                >
                  {authenticated ? "Authenticated" : "Authentication required"}
                </Badge>
              </div>
              <p className="mt-1.5 text-sm text-slate-400">
                {bucket
                  ? `gs://${bucket}/${resolvedPrefix}`
                  : "Bucket configuration is loading"}
              </p>
              <p className="mt-3 max-w-2xl text-xs leading-5 text-slate-400">
                {localMode
                  ? "Files are read through the Google Cloud CLI identity signed in on this computer. Downloads stream from the real bucket."
                  : "Object metadata and selected content are requested directly from the configured GCS bucket. No sample rows are generated."}
              </p>
              {localMode && scope === "transfers" && (
                <div className="mt-4 inline-flex rounded-lg border border-white/15 bg-white/5 p-1">
                  {(["inbound", "outbound"] as const).map((area) => (
                    <button
                      key={area}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${transferArea === area ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:bg-white/10"}`}
                      onClick={() => {
                        setTransferArea(area);
                      }}
                    >
                      {area}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Connection
              </p>
              <p className="mt-1.5 text-sm font-semibold text-white">
                {authenticated ? authMode.replace("-", " ") : "Not authorized"}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Last refresh
              </p>
              <p className="mt-1.5 text-sm font-semibold text-white">
                {lastSync
                  ? lastSync.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  : "Not synced"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="ops-surface ops-data-metric rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">
            Objects in view
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
            {objects.length}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Matched after scanning {scannedCount.toLocaleString()} allowed
            objects{scanTruncated ? " up to the configured limit" : ""}
          </p>
        </div>
        <div className="ops-surface ops-data-metric rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">
            Data in view
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
            {formatBytes(totalBytes)}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Combined object size in the filtered results
          </p>
        </div>
        <div className="ops-surface ops-data-metric rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">
            Latest update
          </p>
          <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950">
            {latest ? formatDate(latest) : "No result"}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Newest object after filters
          </p>
        </div>
      </div>

      <section className="ops-file-console ops-surface rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-4">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-cyan-700" />
            <h2 className="text-sm font-semibold text-slate-950">
              Filter GCS objects
            </h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1.3fr_.62fr_.62fr_.65fr_auto]">
            <label className="grid gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Object name
              </span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void loadObjects("", true);
                  }}
                  placeholder="Search every folder by filename or batch job"
                  className="pl-9"
                />
              </div>
            </label>
            <label className="grid gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Folder navigation
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" disabled={!canGoBack} onClick={handleBack} title="Go back one folder">
                  <ChevronLeft className="size-4" />
                </Button>
                <Select
                  value={prefix || rootPrefix}
                  onValueChange={(value) => {
                    setPrefix(value);
                    void loadObjects("", true, value);
                  }}
                >
                  <SelectTrigger className="flex-1 max-w-[220px]">
                    <SelectValue placeholder="Current folder" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={rootPrefix}>Environment root</SelectItem>
                    {folderOptions.map((folder) => (
                      <SelectItem key={folder} value={folder}>
                        {folder}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </label>
            <label className="grid gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                From
              </span>
              <Input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                To
              </span>
              <Input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                File type
              </span>
              <Select value={fileType} onValueChange={setFileType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="logs">Logs only</SelectItem>
                  <SelectItem value="archives">Archives</SelectItem>
                  <SelectItem value="all">All objects</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div className="flex items-end gap-2">
              <Button variant="outline" onClick={useBusinessDate}>
                Use {businessDate}
              </Button>
              <Button
                className="bg-slate-950 text-white hover:bg-slate-800"
                onClick={() => void loadObjects("", true)}
                disabled={loading}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="grid place-items-center px-6 py-16 text-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-700">
              <CloudOff className="size-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-900">
              GCS logs are not available yet
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
              {error.message}
            </p>
            {error.code === "GCS_AUTH_REQUIRED" && (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={onOpenSettings}>
                  <Settings2 className="size-4" />
                  Review GCS settings
                </Button>
                <Button
                  className="bg-cyan-700 text-white hover:bg-cyan-800"
                  onClick={() => void loadObjects("", true)}
                >
                  <RefreshCw className="size-4" />
                  Retry
                </Button>
              </div>
            )}
          </div>
        ) : loading ? (
          <div className="grid place-items-center py-20">
            <Loader2 className="size-7 animate-spin text-cyan-700" />
            <p className="mt-3 text-sm text-slate-500">
              Reading object metadata from GCS
            </p>
          </div>
        ) : objects.length ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {scope === "reports" ? "Report files" : "Transfer files"}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  All matching files across approved folders. Sort any result
                  without expanding folders.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Select
                  value={sortBy}
                  onValueChange={(value) => setSortBy(value as typeof sortBy)}
                >
                  <SelectTrigger className="h-8 w-32 bg-white text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="updated">Updated time</SelectItem>
                    <SelectItem value="created">Created time</SelectItem>
                    <SelectItem value="name">File name</SelectItem>
                    <SelectItem value="size">File size</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSortDirection((value) =>
                      value === "desc" ? "asc" : "desc",
                    )
                  }
                >
                  {sortDirection === "desc" ? "Newest first" : "Oldest first"}
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table
                className={
                  scope === "reports"
                    ? "min-w-[1360px] table-fixed"
                    : "min-w-[960px]"
                }
              >
                {scope === "reports" && (
                  <colgroup>
                    <col style={{ width: "60px" }} />
                    <col style={{ width: "480px" }} />
                    <col style={{ width: "180px" }} />
                    <col style={{ width: "260px" }} />
                    <col style={{ width: "100px" }} />
                    <col style={{ width: "210px" }} />
                  </colgroup>
                )}
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    {scope === "reports" ? (
                      <>
                        <TableHead className="w-16 pl-5">S.no</TableHead>
                        <TableHead className="w-[450px]">
                          Report file name
                        </TableHead>
                        <TableHead className="w-44">Record type</TableHead>
                        <TableHead className="w-64">Created TS</TableHead>
                        <TableHead className="w-24">Size</TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead className="pl-5">File name</TableHead>
                        <TableHead>Folder</TableHead>
                        <TableHead>Created TS</TableHead>
                        <TableHead>Updated TS</TableHead>
                        <TableHead>Size</TableHead>
                      </>
                    )}
                    <TableHead
                      className={
                        scope === "reports"
                          ? "w-[210px] pr-5 text-right"
                          : "pr-5 text-right"
                      }
                    >
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...objects]
                    .sort((a, b) => {
                      const av =
                        sortBy === "name"
                          ? a.name
                          : sortBy === "size"
                            ? Number(a.size || 0)
                            : String(
                                sortBy === "created"
                                  ? a.timeCreated
                                  : a.updated || "",
                              );
                      const bv =
                        sortBy === "name"
                          ? b.name
                          : sortBy === "size"
                            ? Number(b.size || 0)
                            : String(
                                sortBy === "created"
                                  ? b.timeCreated
                                  : b.updated || "",
                              );
                      const value =
                        typeof av === "number" && typeof bv === "number"
                          ? av - bv
                          : String(av).localeCompare(String(bv));
                      return sortDirection === "desc" ? -value : value;
                    })
                    .map((item, index) => (
                      <TableRow key={item.name}>
                        {scope === "reports" ? (
                          <>
                            <TableCell className="w-16 pl-5 text-slate-500">
                              {index + 1}
                            </TableCell>
                            <TableCell className="w-[450px] max-w-0 overflow-hidden">
                              <button
                                title={reportFileName(item.name)}
                                className="block w-full truncate text-left font-medium text-slate-900 hover:text-cyan-700"
                                onClick={() => void openLog(item)}
                              >
                                {reportFileName(item.name)}
                              </button>
                            </TableCell>
                            <TableCell className="w-44 whitespace-nowrap">
                              <Badge variant="outline">
                                {reportRecordType(item.name)}
                              </Badge>
                            </TableCell>
                            <TableCell className="w-64 whitespace-nowrap text-sm text-slate-600">
                              {formatDate(item.timeCreated || item.updated)}
                            </TableCell>
                            <TableCell className="w-24 whitespace-nowrap text-sm text-slate-600">
                              {formatBytes(Number(item.size || 0))}
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="max-w-[24rem] pl-5 py-4">
                              <div className="flex items-start gap-3">
                                <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-700">
                                  <FileCode2 className="size-4" />
                                </div>
                                <div className="min-w-0">
                                  <button
                                    className="block max-w-full truncate text-left text-sm font-medium text-slate-900 hover:text-cyan-700"
                                    onClick={() => void openLog(item)}
                                  >
                                    {cleanObjectName(item.name)
                                      .split("/")
                                      .pop()}
                                  </button>
                                  <p className="mt-1 truncate font-mono text-[10px] text-slate-400">
                                    {cleanObjectName(item.name)}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-44 truncate text-xs text-slate-500">
                              {item.name.split("/").slice(0, -1).join("/")}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-slate-600">
                              {formatDate(item.timeCreated)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-slate-600">
                              {formatDate(item.updated)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-slate-600">
                              {formatBytes(Number(item.size || 0))}
                            </TableCell>
                          </>
                        )}
                        <TableCell
                          className={
                            scope === "reports"
                              ? "w-[210px] whitespace-nowrap pr-5"
                              : "pr-5"
                          }
                        >
                          <div className="flex min-w-max justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="View report"
                              aria-label="View report"
                              onClick={() => void openLog(item)}
                            >
                              <Eye className="size-3.5" />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon-sm"
                              title="Download report"
                              aria-label="Download report"
                              asChild
                            >
                              <a href={downloadUrl(item.name)}>
                                <Download className="size-3.5" />
                              </a>
                            </Button>
                            {scope === "reports" && (
                              <Button
                                variant="outline"
                                size="icon-sm"
                                title="Analyze report"
                                aria-label="Analyze report"
                                onClick={() => void analyzeReport(item)}
                                disabled={analysisLoading}
                              >
                                {analysisLoading ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <FileSearch className="size-3.5" />
                                )}
                              </Button>
                            )}
                            {scope === "reports" && (
                              <Button
                                variant="outline"
                                size="icon-sm"
                                title="Download as CSV"
                                aria-label="Download as CSV"
                                asChild
                              >
                                <a href={`${downloadUrl(item.name)}&csv=1`}>
                                  <FileSpreadsheet className="size-3.5" />
                                </a>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <p className="text-xs text-slate-500">
                Showing {objects.length} objects from the current GCS API page
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!tokenHistory.length || loading}
                  onClick={() => void previousPage()}
                >
                  <ChevronLeft className="size-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!nextPageToken || loading}
                  onClick={() => void nextPage()}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="grid place-items-center px-6 py-16 text-center">
            <Cloud className="size-10 text-slate-300" />
            <h3 className="mt-4 text-sm font-semibold text-slate-900">
              {initialFolderBrowse && scope === "reports"
                ? "Choose a report folder to load its files"
                : "No GCS objects match these filters"}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              {initialFolderBrowse && scope === "reports"
                ? `${folderOptions.length.toLocaleString()} report folders are ready. Selecting one loads only that folder in pages of up to 1,000 files.`
                : "Change the date range, prefix, object name, or file type and apply again."}
            </p>
          </div>
        )}
      </section>

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-5xl">
          <SheetHeader className="border-b border-slate-100 p-6">
            <div className="pr-8">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-cyan-200 bg-cyan-50 text-cyan-700"
                >
                  GCS object
                </Badge>
                {contentTruncated && (
                  <Badge
                    variant="outline"
                    className="border-amber-200 bg-amber-50 text-amber-700"
                  >
                    Preview truncated
                  </Badge>
                )}
              </div>
              <SheetTitle className="mt-3 truncate text-xl">
                {selected?.name.split("/").pop()}
              </SheetTitle>
              <SheetDescription className="mt-1 break-all font-mono text-[11px]">
                gs://{bucket}/{selected?.name}
              </SheetDescription>
            </div>
          </SheetHeader>
          {selected && (
            <div className="space-y-5 p-6">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">
                    Updated
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-800">
                    {formatDate(selected.updated)}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">
                    Size
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    {formatBytes(Number(selected.size || 0))}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">
                    Errors
                  </p>
                  <p className="mt-1 text-sm font-medium text-rose-700">
                    {severityCounts.ERROR ?? 0}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">
                    Warnings
                  </p>
                  <p className="mt-1 text-sm font-medium text-amber-700">
                    {severityCounts.WARNING ?? 0}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={viewerQuery}
                    onChange={(event) => setViewerQuery(event.target.value)}
                    placeholder="Search inside this log"
                    className="pl-9"
                  />
                </div>
                <Select
                  value={severity}
                  onValueChange={(value) => setSeverity(value as Severity)}
                >
                  <SelectTrigger className="w-full sm:w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All severities</SelectItem>
                    <SelectItem value="ERROR">Errors</SelectItem>
                    <SelectItem value="WARNING">Warnings</SelectItem>
                    <SelectItem value="INFO">Info</SelectItem>
                    <SelectItem value="DEBUG">Debug and trace</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" asChild>
                  <a href={downloadUrl(selected.name)}>
                    <Download className="size-4" />
                    Download full object
                  </a>
                </Button>
                <Button variant="outline" onClick={handleDownloadSelected} disabled={logLines.length === 0}>
                  <Download className="size-4" />
                  Download selected
                </Button>
              </div>
              {contentLoading ? (
                <div className="grid place-items-center rounded-2xl border border-slate-800 bg-slate-950 py-24">
                  <Loader2 className="size-7 animate-spin text-cyan-400" />
                  <p className="mt-3 text-sm text-slate-400">
                    Loading log preview from GCS
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                    <p className="text-xs font-medium text-slate-300">
                      {logLines.length.toLocaleString()} matching lines
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(["ERROR", "WARNING", "INFO", "DEBUG"] as const).map(
                        (value) => (
                          <Badge
                            key={value}
                            variant="outline"
                            className={severityTone[value]}
                          >
                            {value} {severityCounts[value] ?? 0}
                          </Badge>
                        ),
                      )}
                    </div>
                  </div>
                  <div className="max-h-[55vh] overflow-auto p-2 font-mono text-[11px] leading-5">
                    {logLines.slice(0, 1000).map((entry) => (
                      <div
                        key={entry.index}
                        className="grid grid-cols-[3rem_5.5rem_1fr] gap-2 border-b border-white/[0.04] px-2 py-1 hover:bg-white/[0.04]"
                      >
                        <span className="text-right text-slate-600">
                          {entry.index}
                        </span>
                        <span
                          className={`font-semibold ${entry.severity === "ERROR" ? "text-rose-400" : entry.severity === "WARNING" ? "text-amber-400" : entry.severity === "DEBUG" ? "text-violet-400" : "text-cyan-400"}`}
                        >
                          {entry.severity}
                        </span>
                        <span className="whitespace-pre-wrap break-all text-slate-300">
                          {entry.line || " "}
                        </span>
                      </div>
                    ))}
                    {logLines.length > 1000 && (
                      <div className="p-4 text-center text-xs text-amber-300">
                        <AlertTriangle className="mr-2 inline size-4" />
                        Showing the first 1,000 matching lines. Refine the
                        filters or download the selected objects.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={Boolean(analysis)}
        onOpenChange={(open) => !open && setAnalysis(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Report analysis</DialogTitle>
            <DialogDescription className="break-all">
              {analysis?.name}
            </DialogDescription>
          </DialogHeader>
          {analysis && (
            <div className="space-y-5">
              <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4 text-sm leading-6 text-slate-700">
                {analysis.summary}
              </div>
              <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-5">
                {(
                  [
                    ["Declared total", analysis.declaredTotal, "text-slate-700"],
                    ["Parsed records", analysis.parsedRecords, "text-cyan-700"],
                    ["Unique Case IDs", analysis.uniqueCaseIds, "text-indigo-700"],
                    ["Successful", analysis.successfulRecords, "text-emerald-700"],
                    ["Errors", analysis.errorCount, "text-rose-700"],
                    ["Warnings", analysis.warningCount, "text-amber-700"],
                    ["Null findings", analysis.nullCount, "text-violet-700"],
                    ["Mismatches", analysis.mismatches, "text-orange-700"],
                  ] as Array<[string, number | null | undefined, string]>
                ).filter(([_, val]) => val != null).map(([label, value, color]) => (
                  <div
                    key={String(label)}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {label}
                    </p>
                    <p className={`mt-1 text-xl font-semibold ${color}`}>
                      {Number(value).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Observations
                </h3>
                <div className="mt-2 overflow-hidden rounded-xl border border-slate-200">
                  {analysis.observations.length ? (
                    analysis.observations.map((observation) => (
                      <div
                        key={observation.label}
                        className="flex gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0"
                      >
                        <span className="min-w-10 text-right text-sm font-semibold text-slate-900">
                          {observation.count.toLocaleString()}
                        </span>
                        <p className="min-w-0 break-words text-sm leading-5 text-slate-600">
                          <span className="font-medium text-slate-900">
                            {observation.label}.
                          </span>{" "}
                          {observation.detail}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="px-4 py-5 text-sm text-slate-500">
                      No error, warning, or null-related findings were detected
                      in the analyzed content.
                    </p>
                  )}
                </div>
              </div>
              {analysis.truncated && (
                <p className="text-xs text-amber-700">
                  The report is large, so the analysis uses the first 8 MB of
                  text.
                </p>
              )}
            </div>
          )}
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}