"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  ExternalLink,
  FileArchive,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  Pause,
  Play,
  Search,
  Settings,
  ShieldCheck,
  ScrollText,
  Server,
  Filter,
  Loader2,
  type LucideIcon,
} from "lucide-react";

import CloudLogs from "@/components/cloud-logs";
import ExcelManagement from "@/components/excel-management";
import GcsLogs from "@/components/gcs-logs";
import {
  LiveAudit,
  LiveDashboard,
  LiveHistory,
  LiveJobs,
  LivePerformance,
  LiveValidations,
  useApi
} from "@/components/live-operations";
import { ENVIRONMENTS } from "@/lib/environments";
import { LocalConnections } from "@/components/local-connections";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";

type View =
  | "dashboard"
  | "jobs"
  | "validations"
  | "files"
  | "cloudLogs"
  | "datadog"
  | "gcsLogs"
  | "analytics"
  | "history"
  | "excel"
  | "settings"
  | "audit";

const navItems: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "jobs", label: "Batch Jobs", icon: ListChecks },
  {
    id: "validations",
    label: "Pre & Post Validations",
    icon: ShieldCheck,
  },
  { id: "files", label: "Files & Reports", icon: FileArchive },
  { id: "cloudLogs", label: "Cloud Logs", icon: ScrollText },
  { id: "datadog", label: "Datadog Logs", icon: Activity },
  { id: "gcsLogs", label: "GCS Files", icon: Cloud },
  { id: "analytics", label: "Performance", icon: BarChart3 },
  { id: "history", label: "Execution History", icon: History },
  { id: "excel", label: "Excel Management", icon: FileSpreadsheet },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "audit", label: "Audit History", icon: LockKeyhole },
];

const viewCopy: Record<
  View,
  { eyebrow: string; title: string; description: string }
> = {
  dashboard: {
    eyebrow: "Live operational state",
    title: "Operations overview",
    description: "Real connector, catalog, scheduler, and validation activity.",
  },
  jobs: {
    eyebrow: "RunMyJobs and imported configuration",
    title: "Batch jobs",
    description:
      "Live scheduler executions and the active workbook catalog follow the selected business date.",
  },
  validations: {
    eyebrow: "Stored read-only pre and post checks",
    title: "Pre & Post Validations",
    description:
      "Execute imported pre-validation and post-validation checks through approved HTTPS database gateways.",
  },
  files: {
    eyebrow: "Google Cloud Storage",
    title: "Files & reports",
    description:
      "Browse approved object prefixes, preview metadata, and download with audit tracking.",
  },
  cloudLogs: {
    eyebrow: "Google Cloud Logging",
    title: "Application logs",
    description:
      "Search real allowlisted Kubernetes logs with server-generated filters.",
  },
  datadog: {
    eyebrow: "Datadog log search",
    title: "Datadog logs",
    description:
      "Open Datadog with an environment and batch-job search already applied.",
  },
  gcsLogs: {
    eyebrow: "Google Cloud Storage",
    title: "GCS files",
    description:
      "Filter and inspect approved objects directly from the configured bucket.",
  },
  analytics: {
    eyebrow: "Recorded activity only",
    title: "Performance",
    description:
      "Measured validation outcomes and gateway duration, without synthetic baselines.",
  },
  history: {
    eyebrow: "Persisted execution ledger",
    title: "Execution history",
    description:
      "Review real validation attempts and their correlation identifiers.",
  },
  excel: {
    eyebrow: "Configuration sources",
    title: "Excel management",
    description:
      "Upload Daily jobs, Special jobs, and Pre/Post query workbooks independently.",
  },
  settings: {
    eyebrow: "Environment-aware configuration",
    title: "Settings",
    description: "Configure, test, and audit real external-system connections.",
  },
  audit: {
    eyebrow: "Recorded system activity",
    title: "Audit history",
    description:
      "Review configuration, connection, query, log, and file-access events.",
  },
};

function formatBusinessDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function shiftBusinessDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function currentHonoluluDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function PageHeading({
  view,
  businessDate,
}: {
  view: View;
  businessDate?: string;
}) {
  const copy = viewCopy[view];
  const dateAware = [
    "dashboard",
    "jobs",
    "validations",
    "files",
    "gcsLogs",
  ].includes(view);
  return (
    <div className="ops-page-heading pb-2">
      <div className="ops-page-heading-copy">
      <p className="ops-eyebrow">
        {businessDate && dateAware
          ? `Business date · ${formatBusinessDate(businessDate)}`
          : copy.eyebrow}
      </p>
      <h1 className="ops-page-title">
        {copy.title}
      </h1>
      <p className="ops-page-description">{copy.description}</p>
      </div>
    </div>
  );
}

function AppSidebar({
  active,
  onChange,
}: {
  active: View;
  onChange: (view: View) => void;
}) {
  const operationItems = navItems.slice(0, 8);
  const renderItem = (item: (typeof navItems)[number]) => (
    <SidebarMenuItem key={item.id}>
      <SidebarMenuButton
        isActive={active === item.id}
        className={`ops-nav-item ${operationItems.includes(item) ? "ops-nav-tile" : "ops-nav-row"}`}
        aria-current={active === item.id ? "page" : undefined}
        onClick={() => onChange(item.id)}
      >
        <item.icon className="size-4" />
        <span className="ops-nav-name">{item.label}</span>
        <ChevronRight className="ops-nav-arrow" aria-hidden="true" />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
  return (
    <Sidebar
      variant="inset"
      collapsible="offcanvas"
      className="ops-sidebar"
    >
      <SidebarHeader className="ops-sidebar-header">
        <div className="flex items-center gap-3">
          <div className="ops-brand-mark">
            <span aria-hidden="true">BO</span>
          </div>
          <div>
            <p className="ops-brand-eyebrow">
              Batch Ops
            </p>
            <p className="ops-brand-name">Control Center</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="ops-sidebar-content [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <SidebarGroup>
          <SidebarGroupLabel className="ops-nav-label">
            Operations
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="ops-module-grid">{operationItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="ops-nav-label">
            Administration
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{navItems.slice(8).map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="ops-sidebar-footer">
        <button
          className="ops-connection-shortcut"
          onClick={() => onChange("settings")}
        >
          <div className="flex items-center gap-2">
            <Settings className="size-4 text-sky-300" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-100">
              Your connections
            </p>
            <ChevronRight className="ml-auto size-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Manage environments and check connection health.
          </p>
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}

function DatadogLogs({
  heading,
  environment,
  initialJobName,
}: {
  heading: ReactNode;
  environment: string;
  initialJobName: string;
}) {
  const [jobName, setJobName] = useState(initialJobName);
  const [moduleName, setModuleName] = useState("bes-int-cons");
  const [timeRange, setTimeRange] = useState("15m");

  const modules = [
    "bes-api", "bes-batch", "bes-connector", "bes-core",
    "bes-cpd", "bes-ctm", "bes-db", "bes-fis", "bes-fmm",
    "bes-ids", "bes-int-cons", "bes-lib", "bes-model",
    "bes-mongodb", "bes-rms", "bes-sspmodel", "bes-tpm"
  ];

  const openDatadog = () => {
    const envCode = environment.replace(/^(NP_|PROD_)/, "").toLowerCase();
    const ddEnv = environment.startsWith("PROD_") ? `prod-${envCode}` : `np-${envCode}`;

    const query = [
      `env:${ddEnv}`,
      `service:${moduleName}`,
      jobName.trim() ? `"${jobName.trim()}"` : "",
    ].filter(Boolean).join(" ");

    let fromTs = "now-15m";
    if (timeRange === "1h") fromTs = "now-1h";
    if (timeRange === "4h") fromTs = "now-4h";
    if (timeRange === "1d") fromTs = "now-1d";

    const url = `https://us5.datadoghq.com/logs?query=${encodeURIComponent(query)}&from_ts=${fromTs}&to_ts=now&live=true`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>{heading}</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openDatadog}>
            <ExternalLink className="size-4" />
            Open Log Explorer (US5)
          </Button>
        </div>
      </div>
      <section className="ops-surface overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-4">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-violet-700" />
            <h2 className="text-sm font-semibold text-slate-950">Datadog log filters</h2>
          </div>
        </div>
        <div className="p-4 grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1.5fr_1fr_1.5fr_auto]">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Target environment
            <Input value={environment.replace(/^(NP_|PROD_)/, "").toLowerCase() || "local"} disabled className="bg-slate-50 font-semibold" />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Module / service
            <Select value={moduleName} onValueChange={setModuleName}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {modules.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Live time range
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15m">Past 15 minutes</SelectItem>
                <SelectItem value="1h">Past 1 hour</SelectItem>
                <SelectItem value="4h">Past 4 hours</SelectItem>
                <SelectItem value="1d">Past 1 day</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Batch job search
            <Input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="Optional job name constraint" />
          </label>
          <div className="flex items-end">
            <Button className="bg-violet-700 text-white hover:bg-violet-800 w-full" onClick={openDatadog}>
              <Search className="size-4" /> Search Datadog
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function ControlCenter() {
  const [view, setView] = useState<View>("dashboard");
  const [businessDate, setBusinessDate] = useState(currentHonoluluDate);
  const [searchQuery, setSearchQuery] = useState("");
  const [environment, setEnvironment] = useState("LOCAL");
  const [motionPaused, setMotionPaused] = useState(false);
  const [validationGroup, setValidationGroup] = useState<"Scheduled" | "Unscheduled">("Scheduled");
  
  // Group 5: Fetch global dashboard shortcut data
  const shortcutData = useApi<any>(`/api/operations/overview?environment=${encodeURIComponent(environment)}`);

  useEffect(() => {
    const syncVisibility = () => {
      document.documentElement.dataset.pageHidden = String(document.hidden);
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      delete document.documentElement.dataset.pageHidden;
    };
  }, []);

  const heading = (target: View, date = false): ReactNode => (
    <PageHeading key={target} view={target} businessDate={date ? businessDate : undefined} />
  );

  const content = (() => {
    if (view === "dashboard")
      return (
        <LiveDashboard
          heading={heading("dashboard", true)}
          businessDate={businessDate}
          environment={environment}
          onOpenSettings={() => setView("settings")}
          onOpenJobs={() => setView("jobs")}
          onOpenFiles={() => setView("files")}
          onOpenValidations={(group) => {
            setValidationGroup(group);
            setView("validations");
          }}
        />
      );
    if (view === "jobs")
      return (
        <LiveJobs
          key={`${environment}-${businessDate}-${searchQuery}`}
          heading={heading("jobs", true)}
          businessDate={businessDate}
          initialQuery={searchQuery}
          environment={environment}
          onOpenSettings={() => setView("settings")}
        />
      );
    if (view === "validations")
      return (
        <LiveValidations
          heading={heading("validations", true)}
          businessDate={businessDate}
          environment={environment}
          initialGroup={validationGroup}
        />
      );
    if (view === "files")
      return (
        <GcsLogs
          heading={heading("files", true)}
          businessDate={businessDate}
          environment={environment}
          scope="reports"
          onOpenSettings={() => setView("settings")}
        />
      );
    if (view === "cloudLogs")
      return (
        <CloudLogs
          heading={heading("cloudLogs")}
          environment={environment}
          onOpenSettings={() => setView("settings")}
        />
      );
    if (view === "datadog")
      return (
        <DatadogLogs
          heading={heading("datadog")}
          environment={environment}
          initialJobName={searchQuery}
        />
      );
    if (view === "gcsLogs")
      return (
        <GcsLogs
          heading={heading("gcsLogs", true)}
          businessDate={businessDate}
          environment={environment}
          scope="transfers"
          onOpenSettings={() => setView("settings")}
        />
      );
    if (view === "analytics")
      return <LivePerformance heading={heading("analytics")} />;
    if (view === "history") return <LiveHistory heading={heading("history")} />;
    if (view === "excel") return <ExcelManagement heading={heading("excel")} />;
    if (view === "settings")
      return (
        <LocalConnections
          heading={heading("settings")}
          environment={environment}
          onEnvironmentChange={setEnvironment}
        />
      );
    return <LiveAudit heading={heading("audit")} />;
  })();

  return (
    <SidebarProvider className="ops-shell" data-template="color-studio" data-active-view={view} data-motion={motionPaused ? "paused" : "running"} style={{ "--sidebar-width": "15rem" } as CSSProperties}>
      <a href="#workspace-content" className="ops-skip-link">Skip to workspace</a>
      <AppSidebar active={view} onChange={setView} />
      <SidebarInset className="ops-workspace min-w-0">
        <header className="ops-topbar">
          <div className="ops-topbar-leading">
            <SidebarTrigger className="-ml-1" />
            <div className="ops-breadcrumb" aria-label="Current workspace">
              <span>Workspace</span><span className="ops-breadcrumb-slash">/</span><strong>{navItems.find((item) => item.id === view)?.label}</strong>
            </div>
            <div className="ops-global-search relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setView("jobs");
                }}
                placeholder="Search jobs and runs"
                aria-label="Search jobs and runs"
                className="h-9 border-slate-200 bg-slate-50 pl-9 shadow-none"
              />
            </div>
          </div>
          <div className="ops-topbar-controls">
            {/* Global dashboard shortcuts populated by dynamic data */}
            <div className="hidden lg:flex items-center gap-4 text-[11px] font-medium text-slate-600 mr-2 bg-slate-100/50 px-3 py-1.5 rounded-full border border-slate-200">
              {shortcutData.loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <>
                  <span className="flex items-center gap-1.5"><Server className="size-3.5 text-emerald-600" /> {shortcutData.data?.metrics?.connectedIntegrations ?? 0} connected</span>
                  <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5 text-cyan-600" /> {shortcutData.data?.metrics?.activeCatalogJobs ?? 0} jobs</span>
                  <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-amber-600" /> {shortcutData.data?.metrics?.validationRuns ?? 0} runs</span>
                </>
              )}
            </div>

            <div className="ops-date-control">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous business date"
                onClick={() =>
                  setBusinessDate((value) => shiftBusinessDate(value, -1))
                }
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <CalendarDays className="ml-1 hidden size-3.5 text-slate-400 md:block" />
              <Input
                type="date"
                value={businessDate}
                onChange={(event) => {
                  if (event.target.value) setBusinessDate(event.target.value);
                }}
                aria-label="Business date"
                className="h-7 w-32 border-0 bg-transparent px-1 text-sm font-semibold text-slate-900 shadow-none md:w-36"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next business date"
                onClick={() =>
                  setBusinessDate((value) => shiftBusinessDate(value, 1))
                }
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
            <select
              aria-label="Environment"
              value={environment}
              onChange={(event) => {
                const next = event.target.value;
                setEnvironment(next);
              }}
              className="ops-environment-select"
            >
              {(["Local", "Non-prod", "Prod"] as const).map((tier) => (
                <optgroup key={tier} label={tier}>
                  {ENVIRONMENTS.filter((item) => item.tier === tier).map(
                    (item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ),
                  )}
                </optgroup>
              ))}
            </select>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ops-motion-toggle"
              aria-label={motionPaused ? "Resume visual motion" : "Pause visual motion"}
              title={motionPaused ? "Resume visual motion" : "Pause visual motion"}
              aria-pressed={motionPaused}
              onClick={() => setMotionPaused((paused) => !paused)}
            >
              {motionPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </Button>
          </div>
        </header>
        <div id="workspace-content" tabIndex={-1} className="ops-content" data-view={view}>{content}</div>
      </SidebarInset>
      <Toaster position="bottom-right" richColors />
    </SidebarProvider>
  );
}