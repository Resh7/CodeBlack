"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarCheck2, CalendarRange, CheckCircle2, Database, Download, Eye, FileSearch, FileSpreadsheet, ListChecks, Loader2, RotateCcw, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ImportKind = "DAILY" | "SPECIAL" | "VALIDATION";
type ParsedSheet = { name: string; columns: string[]; rows: Record<string, unknown>[] };
type ParsedWorkbook = { file: File; sheets: ParsedSheet[]; jobColumn: string; importKind: ImportKind };
type ImportRecord = {
  id: string;
  filename: string;
  uploadedAt: string;
  uploadedBy: string;
  importKind: ImportKind;
  status: "Active" | "Previous";
  sheetCount: number;
  rowCount: number;
  columnCount: number;
  sheetsJson: string;
  columnsJson: string;
  changesJson: string;
};

const kinds: Record<ImportKind, { label: string; shortLabel: string; description: string; icon: typeof FileSpreadsheet; tone: string; button: string }> = {
  DAILY: {
    label: "Daily jobs list",
    shortLabel: "Daily jobs",
    description: "Regular business-day schedules and recurring job definitions.",
    icon: CalendarCheck2,
    tone: "border-cyan-200 bg-cyan-50 text-cyan-800",
    button: "bg-cyan-700 text-white hover:bg-cyan-800",
  },
  SPECIAL: {
    label: "Special jobs list",
    shortLabel: "Special jobs",
    description: "Month-end, holiday, ad-hoc, and date-specific schedules.",
    icon: CalendarRange,
    tone: "border-violet-200 bg-violet-50 text-violet-800",
    button: "bg-violet-700 text-white hover:bg-violet-800",
  },
  VALIDATION: {
    label: "Pre and post queries",
    shortLabel: "Pre/Post queries",
    description: "Read-only validation queries, comments, and run instructions.",
    icon: ListChecks,
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    button: "bg-emerald-700 text-white hover:bg-emerald-800",
  },
};

function Metric({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof FileSpreadsheet; tone: string }) {
  return <div className="ops-surface ops-data-metric rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">{value}</p></div><div className={`grid size-9 place-items-center rounded-xl ${tone}`}><Icon className="size-4"/></div></div><p className="mt-3 text-xs text-slate-500">{detail}</p></div>;
}

function statusBadge(status: ImportRecord["status"]) {
  return <Badge variant="outline" className={status === "Active" ? "rounded-full border-cyan-200 bg-cyan-50 text-cyan-700" : "rounded-full border-slate-200 bg-slate-50 text-slate-500"}>{status}</Badge>;
}

function kindBadge(kind: ImportKind) {
  return <Badge variant="outline" className={`rounded-full ${kinds[kind].tone}`}>{kinds[kind].shortLabel}</Badge>;
}

async function parseWorkbook(file: File, importKind: ImportKind): Promise<ParsedWorkbook> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const workbook = extension === "csv"
    ? XLSX.read(await file.text(), { type: "string", cellDates: true })
    : XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheets = workbook.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: "", raw: false });
    return { name, rows, columns: rows[0] ? Object.keys(rows[0]) : [] };
  }).filter((sheet) => sheet.columns.length > 0);
  const columns = [...new Set(sheets.flatMap((sheet) => sheet.columns))];
  const preferred = importKind === "VALIDATION" ? ["jobname", "rmjjobname", "rmjjobnames"] : ["rmjjobname", "rmjjobnames", "jobname", "job", "name"];
  const jobColumn = columns.find((column) => preferred.includes(column.toLowerCase().replace(/[^a-z0-9]/g, ""))) ?? "";
  return { file, sheets, jobColumn, importKind };
}

export default function ExcelManagement({ heading }: { heading: ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingKind, setPendingKind] = useState<ImportKind>("DAILY");
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [activeCounts, setActiveCounts] = useState<Partial<Record<ImportKind, number>>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [selectedImport, setSelectedImport] = useState<ImportRecord | null>(null);

  const loadImports = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/imports", { cache: "no-store" });
      const payload = await response.json() as { imports?: ImportRecord[]; activeJobCount?: number; activeCounts?: Partial<Record<ImportKind, number>>; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load imports.");
      setImports(payload.imports ?? []);
      setActiveJobCount(payload.activeJobCount ?? 0);
      setActiveCounts(payload.activeCounts ?? {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load imports.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadImports(), 0);
    return () => window.clearTimeout(timer);
  }, [loadImports]);

  const activeImports = useMemo(() => imports.filter((item) => item.status === "Active"), [imports]);
  const parsedColumns = useMemo(() => parsed ? [...new Set(parsed.sheets.flatMap((sheet) => sheet.columns))] : [], [parsed]);
  const parsedRows = parsed?.sheets.reduce((total, sheet) => total + sheet.rows.length, 0) ?? 0;

  function beginUpload(importKind: ImportKind) {
    setPendingKind(importKind);
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.click();
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    try {
      const next = await parseWorkbook(file, pendingKind);
      if (!next.sheets.length) throw new Error("No readable rows were found in this workbook.");
      setParsed(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to read this workbook.");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function applyImport() {
    if (!parsed || !parsed.jobColumn) {
      toast.error("Select the column containing the job name.");
      return;
    }
    setUploading(true);
    try {
      const metadata = {
        sheets: parsed.sheets.map((sheet) => ({
          ...sheet,
          rows: sheet.rows.map((row) => ({ ...row, "Job Name": row[parsed.jobColumn] })),
        })),
      };
      const form = new FormData();
      form.append("file", parsed.file);
      form.append("importKind", parsed.importKind);
      form.append("metadata", JSON.stringify(metadata));
      const response = await fetch("/api/imports", { method: "POST", body: form });
      const payload = await response.json() as { import?: { normalizedJobs: number }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Import failed.");
      toast.success(`${payload.import?.normalizedJobs ?? 0} ${kinds[parsed.importKind].shortLabel.toLowerCase()} rows imported`);
      setParsed(null);
      if (inputRef.current) inputRef.current.value = "";
      await loadImports();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setUploading(false);
    }
  }

  return <div className="space-y-6">
    <input ref={inputRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(event) => void chooseFile(event.target.files?.[0])}/>
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div>{heading}</div><Button variant="outline" onClick={() => void loadImports()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin"/> : <RotateCcw className="size-4"/>}Refresh</Button></div>

    <section className="ops-surface rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4"><h2 className="text-sm font-semibold text-slate-950">Choose configuration source</h2><p className="mt-1 text-xs text-slate-500">Each category keeps its own active workbook and version history.</p></div>
      <div className="grid gap-3 lg:grid-cols-3">
        {(Object.entries(kinds) as [ImportKind, typeof kinds[ImportKind]][]).map(([kind, meta]) => <div key={kind} className={`ops-import-module rounded-xl border p-4 ${meta.tone}`}><div className="flex items-start justify-between gap-3"><div className="grid size-10 place-items-center rounded-xl bg-white/80"><meta.icon className="size-5"/></div>{activeCounts[kind] != null && <Badge variant="outline" className="border-current/20 bg-white/70">{activeCounts[kind]} active</Badge>}</div><h3 className="mt-4 text-sm font-semibold text-slate-950">{meta.label}</h3><p className="mt-1.5 min-h-10 text-xs leading-5 text-slate-600">{meta.description}</p><Button className={`mt-4 w-full ${meta.button}`} onClick={() => beginUpload(kind)}><Upload className="size-4"/>Upload {meta.shortLabel.toLowerCase()}</Button></div>)}
      </div>
    </section>

    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Active sources" value={`${activeImports.length} / 3`} detail="Daily, special, and validation workbooks" icon={FileSpreadsheet} tone="bg-cyan-50 text-cyan-700"/><Metric label="Normalized jobs" value={activeJobCount.toLocaleString()} detail="Across all active configuration sources" icon={Database} tone="bg-slate-100 text-slate-700"/><Metric label="Mapping health" value={activeImports.length ? "100%" : "0%"} detail={activeImports.length ? "All active sources have a job-name mapping" : "Waiting for the first workbook"} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-700"/></div>

    <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
      <section className="ops-surface rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold text-slate-950">Workbook versions</h2><p className="mt-0.5 text-xs text-slate-500">Stored files, categories, and normalized import metadata</p></div>{loading ? <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-cyan-700"/></div> : imports.length ? <div className="divide-y divide-slate-100">{imports.map((item) => { const changes = JSON.parse(item.changesJson || "{}") as { added?: number; updated?: number; deactivated?: number }; const kindImports = imports.filter((candidate) => candidate.importKind === item.importKind); const version = kindImports.length - kindImports.findIndex((candidate) => candidate.id === item.id); return <div key={item.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><FileSpreadsheet className="size-5"/></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium text-slate-900">{item.filename}</p>{kindBadge(item.importKind)}{statusBadge(item.status)}</div><p className="mt-1 text-xs text-slate-500">Version {version} · {item.rowCount} rows · {item.sheetCount} sheet{item.sheetCount === 1 ? "" : "s"}</p><p className="mt-2 text-xs font-medium text-slate-600">+{changes.added ?? 0} added · {changes.updated ?? 0} matched · {changes.deactivated ?? 0} deactivated</p></div></div><div className="flex shrink-0 gap-1"><Button variant="ghost" size="sm" onClick={() => setSelectedImport(item)}><Eye className="size-3.5"/>Details</Button><Button variant="outline" size="sm" asChild><a href={`/api/imports/${item.id}/file`}><Download className="size-3.5"/>Download</a></Button></div></div>; })}</div> : <div className="grid place-items-center px-5 py-16 text-center"><FileSearch className="size-9 text-slate-300"/><p className="mt-3 text-sm font-medium text-slate-800">No workbook imported yet</p><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">Choose one of the three configuration sources above to upload its first CSV, XLS, or XLSX file.</p></div>}</section>
      <div className="space-y-5"><section className="ops-surface ops-data-metric rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold text-slate-950">Active sheet mappings</h2>{activeImports.length ? <div className="mt-4 space-y-3">{activeImports.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-medium text-slate-900">{kinds[item.importKind].label}</p><p className="mt-0.5 max-w-56 truncate text-xs text-slate-500">{item.filename}</p></div><CheckCircle2 className="size-4 shrink-0 text-emerald-600"/></div><div className="mt-3 flex flex-wrap gap-1.5">{(JSON.parse(item.sheetsJson || "[]") as { name: string; rows: number; columns: number }[]).map((sheet) => <Badge key={sheet.name} variant="secondary" className="font-normal">{sheet.name} · {sheet.rows} rows</Badge>)}</div></div>)}</div> : <p className="mt-4 text-xs leading-5 text-slate-500">Mappings will appear after the first successful upload.</p>}</section><section className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-5"><CheckCircle2 className="size-5 text-cyan-700"/><h2 className="mt-3 text-sm font-semibold text-slate-950">Independent versioning</h2><p className="mt-1.5 text-xs leading-5 text-slate-600">Uploading a new daily list replaces only the active daily version. Special jobs and pre/post queries remain active until their own files are updated.</p></section></div>
    </div>

    <Dialog open={Boolean(parsed)} onOpenChange={(open) => !open && setParsed(null)}><DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>Review {parsed ? kinds[parsed.importKind].label.toLowerCase() : "workbook"} import</DialogTitle><DialogDescription>Nothing is saved until you confirm this preview. Daily and Special rows are schedule records, so repeated RMJ names are allowed.</DialogDescription></DialogHeader>{parsed && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-5"><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Category</p><p className="mt-1 text-sm font-medium text-slate-800">{kinds[parsed.importKind].shortLabel}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">File</p><p className="mt-1 truncate text-sm font-medium text-slate-800">{parsed.file.name}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Sheets</p><p className="mt-1 text-sm font-medium text-slate-800">{parsed.sheets.length}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Rows</p><p className="mt-1 text-sm font-medium text-slate-800">{parsedRows.toLocaleString()}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Columns</p><p className="mt-1 text-sm font-medium text-slate-800">{parsedColumns.length}</p></div></div><div><label className="text-xs font-semibold uppercase tracking-wider text-slate-500">{parsed.importKind === "VALIDATION" ? "Validation job-name column" : "RMJ job-name column"}</label><Select value={parsed.jobColumn} onValueChange={(jobColumn) => setParsed({ ...parsed, jobColumn })}><SelectTrigger className="mt-2 w-full"><SelectValue placeholder="Select the column containing job names"/></SelectTrigger><SelectContent>{parsedColumns.map((column) => <SelectItem key={column} value={column}>{column}</SelectItem>)}</SelectContent></Select><p className="mt-2 text-xs text-slate-500">{parsed.importKind === "VALIDATION" ? "This is used to link PreValidation and PostValidation to scheduled jobs." : "Date and schedule group remain on every row for business-date selection."}</p></div><div className="rounded-xl border border-slate-200"><Table><TableHeader><TableRow>{parsedColumns.slice(0, 5).map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{parsed.sheets[0]?.rows.slice(0, 5).map((row, index) => <TableRow key={index}>{parsedColumns.slice(0, 5).map((column) => <TableCell key={column} className="max-w-52 truncate text-xs">{String(row[column] ?? "")}</TableCell>)}</TableRow>)}</TableBody></Table></div></div>}<DialogFooter><Button variant="outline" onClick={() => setParsed(null)}>Cancel</Button><Button className={parsed ? kinds[parsed.importKind].button : ""} disabled={uploading || !parsed?.jobColumn} onClick={() => void applyImport()}>{uploading ? <Loader2 className="size-4 animate-spin"/> : <Upload className="size-4"/>}Apply {parsed ? kinds[parsed.importKind].shortLabel.toLowerCase() : "import"}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(selectedImport)} onOpenChange={(open) => !open && setSelectedImport(null)}><DialogContent><DialogHeader><DialogTitle>{selectedImport?.filename}</DialogTitle><DialogDescription>{selectedImport ? kinds[selectedImport.importKind].label : "Workbook"} metadata and detected changes</DialogDescription></DialogHeader>{selectedImport && <div className="space-y-3 text-sm"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Uploaded by</p><p className="mt-1 font-medium text-slate-800">{selectedImport.uploadedBy}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Uploaded at</p><p className="mt-1 font-medium text-slate-800">{new Date(selectedImport.uploadedAt).toLocaleString()}</p></div></div><div className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Columns</p><p className="mt-2 text-xs leading-5 text-slate-600">{(JSON.parse(selectedImport.columnsJson || "[]") as string[]).join(", ")}</p></div></div>}</DialogContent></Dialog>
  </div>;
}
