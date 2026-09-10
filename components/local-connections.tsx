"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Cloud,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Server,
  TestTube2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Config = {
  oracleConnectString: string;
  oracleUser: string;
  oraclePassword?: string;
  mongoUrl: string;
  mongoPassword?: string;
  rmjJobsUrl: string;
  rmjToken?: string;
  podmanCommand: string;
  logContainers: string;
  gcsProject: string;
  gcsBucket: string;
  gcsPrefix: string;
  gcsReportsPrefix: string;
  gcsInboundPrefix: string;
  gcsOutboundPrefix: string;
  gcloudCommand: string;
  logAnalyticsEndpoint?: string;
  logAnalyticsToken?: string;
  oracleClientCommand?: string;
  mongoClientCommand?: string;
};

const blank: Config = {
  oracleConnectString: "localhost:1521/FCM_LOCAL",
  oracleUser: "BES",
  mongoUrl: "mongodb://bes:mongodb@localhost:27017/besAudit?authSource=admin",
  rmjJobsUrl: "",
  podmanCommand: "podman",
  logContainers: "oracledb,mongodb,mock-boomi-ws",
  gcsProject: "bes-np",
  gcsBucket: "dhs-bes-np-gcs-intcons-to-process-local",
  gcsPrefix: "",
  gcsReportsPrefix: "BatchControlReport/LOCAL/",
  gcsInboundPrefix: "INBOUND/LOCAL/",
  gcsOutboundPrefix: "OUTBOUND/LOCAL/",
  gcloudCommand: "R:\\Cloud\\google-cloud-sdk\\bin\\gcloud.ps1",
  logAnalyticsEndpoint: "",
  logAnalyticsToken: "",
};

export function LocalConnections({
  heading,
  environment = "LOCAL",
  onEnvironmentChange,
}: {
  heading?: ReactNode;
  environment?: string;
  onEnvironmentChange?: (environment: string) => void;
}) {
  const isNonProd = [
    "DEV1", "DEV2", "HAN1", "INT1", "SIT1", "TIM1", "NP_PER1", "TRN1", "TRN2"
  ].includes(environment);
  const isProduction = ["UAT1", "PROD_TIM3", "PER1", "STG1"].includes(environment);

  const [config, setConfig] = useState<Config>(blank);
  const [savedProfiles, setSavedProfiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  const connectorGroups = [
    {
      id: "oracle",
      title: "Oracle",
      icon: Database,
      tone: "bg-rose-100 border-rose-200 text-rose-700",
      bg: "bg-rose-50/40 border-rose-200",
      detail: "Validates this environment's configured Oracle connection.",
      fields: [
        { key: "oracleConnectString", label: "Oracle connect string", placeholder: "host:port/service" },
        { key: "oracleUser", label: "Oracle user", placeholder: "Read-only local user" },
        { key: "oraclePassword", label: "Oracle password", placeholder: "Saved only by local connector", type: "password" },
        { key: "oracleClientCommand", label: "Oracle client command", placeholder: "sqlplus", help: "Runs directly from this computer over VPN. Provide the full sqlplus path if it is not on PATH.", showIf: isNonProd }
      ]
    },
    {
      id: "mongo",
      title: "MongoDB",
      icon: Database,
      tone: "bg-emerald-100 border-emerald-200 text-emerald-700",
      bg: "bg-emerald-50/40 border-emerald-200",
      detail: "Validates this environment's configured MongoDB connection.",
      fields: [
        { key: "mongoUrl", label: "MongoDB URL", placeholder: "mongodb://localhost:27017/database" },
        { key: "mongoClientCommand", label: "MongoDB client command", placeholder: "mongosh", help: "Runs directly from this computer over VPN.", showIf: isNonProd }
      ]
    },
    {
      id: "rmj",
      title: "RunMyJobs",
      icon: Server,
      tone: "bg-blue-100 border-blue-200 text-blue-700",
      bg: "bg-blue-50/40 border-blue-200",
      detail: "Reads the configured scheduler jobs endpoint for this environment.",
      fields: [
        { key: "rmjJobsUrl", label: "RunMyJobs jobs URL", placeholder: "https://.../rest/v1/jobs", help: "The direct read-only jobs endpoint for this selected environment." },
        { key: "rmjToken", label: "RunMyJobs API token", placeholder: "Saved only by the connector on this computer", type: "password" }
      ]
    },
    {
      id: "gcs",
      title: "Google Cloud Storage",
      icon: Cloud,
      tone: "bg-amber-100 border-amber-200 text-amber-700",
      bg: "bg-amber-50/40 border-amber-200",
      detail: "Uses your signed-in company Google Cloud CLI account for GCS files and reports.",
      fields: [
        { key: "gcsProject", label: "Google Cloud project", placeholder: isProduction ? "Add production project" : "bes-np" },
        { key: "gcsBucket", label: "GCS bucket", placeholder: isProduction ? "Add production bucket" : "dhs-bes-np-gcs-intcons-to-process" },
        { key: "gcsReportsPrefix", label: "Reports prefix", placeholder: isProduction ? "Add production reports prefix" : "BatchControlReport/" },
        { key: "gcsInboundPrefix", label: "Inbound prefix", placeholder: isProduction ? "Add production inbound prefix" : "INBOUND/" },
        { key: "gcsOutboundPrefix", label: "Outbound prefix", placeholder: isProduction ? "Add production outbound prefix" : "OUTBOUND/" },
        { key: "gcloudCommand", label: "Google Cloud CLI command", placeholder: "C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd", help: "Leave this blank first. On Windows the connector automatically uses gcloud.cmd." }
      ]
    },
    {
      id: "cloud-logs",
      title: "Google Cloud Logging",
      icon: Cloud,
      tone: "bg-violet-100 border-violet-200 text-violet-700",
      bg: "bg-violet-50/40 border-violet-200",
      detail: "Uses that same Google Cloud CLI account to search Log Explorer entries for this environment.",
      fields: [
        { key: "logAnalyticsEndpoint", label: "Optional exact-count analytics endpoint", placeholder: "Provided by the platform team", help: "Keep this blank for normal Log Explorer viewing." },
        { key: "logAnalyticsToken", label: "Analytics access token", placeholder: "Only if the approved analytics endpoint requires it", type: "password" }
      ]
    },
    {
      id: "logs",
      title: "Container logs",
      icon: FileText,
      tone: "bg-slate-100 border-slate-200 text-slate-700",
      bg: "bg-slate-50/40 border-slate-200",
      detail: "Reads recent output from your named Podman containers.",
      localOnly: true,
      fields: [
        { key: "podmanCommand", label: "Container command", placeholder: "podman", showIf: !isNonProd },
        { key: "logContainers", label: "Log containers", placeholder: "container-a,container-b", showIf: !isNonProd }
      ]
    }
  ];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `http://localhost:8788/local-bes/config?environment=${encodeURIComponent(environment)}`,
      );
      const p = await r.json();
      if (!r.ok) throw new Error(p.message);
      setConfig({ ...blank, ...p.config });
      setSavedProfiles(Array.isArray(p.profiles) ? p.profiles : []);
    } catch {
      toast.message("Start npm run local-agent to configure Local BES connections.");
    } finally {
      setLoading(false);
    }
  }, [environment]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(targetId: string) {
    setSaving(targetId);
    try {
      const r = await fetch("http://localhost:8788/local-bes/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment, config }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.message);
      setConfig({ ...blank, ...p.config });
      setSavedProfiles(Array.isArray(p.profiles) ? p.profiles : []);
      toast.success(`${targetId.toUpperCase()} settings saved locally`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save local settings.");
    } finally {
      setSaving(null);
    }
  }

  async function test(target: string) {
    setTesting(target);
    try {
      const r = await fetch("http://localhost:8788/local-bes/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, environment }),
      });
      const p = await r.json();
      const item = {
        ok: Boolean(r.ok && p.ok),
        message: p.message || `HTTP ${r.status}`,
      };
      setResult((current) => ({ ...current, [target]: item }));
      if (item.ok) toast.success(`${target} connection passed`);
      else toast.error(item.message);
    } catch {
      setResult((current) => ({
        ...current,
        [target]: { ok: false, message: "Local connector is not running." },
      }));
    } finally {
      setTesting(null);
    }
  }

  const update = (key: keyof Config, value: string) =>
    setConfig((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-5 pb-8">
      {heading}
      <section className="ops-surface ops-data-metric rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Server className="size-5 text-cyan-700" />
              <h2 className="text-base font-semibold text-slate-950">
                {environment === "LOCAL"
                  ? "Local BES connections"
                  : `${environment.replace(/^(NP_|PROD_)/, "")} connections`}
              </h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              This profile is saved only on your computer and is used for the
              selected environment across jobs, logs, files, and validations.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              Saved profile
              <select
                value={environment}
                onChange={(event) => onEnvironmentChange?.(event.target.value)}
                className="h-8 max-w-40 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800"
              >
                <option value={environment}>{environment}</option>
                {savedProfiles
                  .filter((profile) => profile !== environment)
                  .map((profile) => (
                    <option key={profile} value={profile}>
                      {profile}
                    </option>
                  ))}
              </select>
            </label>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Reload
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          {connectorGroups.filter(g => environment === "LOCAL" || !g.localOnly).map(group => (
            <div key={group.id} className={`rounded-2xl border ${group.bg} p-5 shadow-sm flex flex-col justify-between`}>
              <div>
                <div className="flex items-start justify-between gap-3 mb-5">
                  <div className="flex gap-3">
                    <div className={`grid size-10 place-items-center rounded-xl ${group.tone}`}>
                      <group.icon className="size-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
                      <p className="mt-1 text-xs text-slate-600">{group.detail}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3">
                  {group.fields.filter(f => f.showIf === undefined || f.showIf).map(field => (
                    <label key={field.key} className="grid gap-1.5 text-xs font-semibold text-slate-800">
                      {field.label}
                      <Input
                        type={field.type || "text"}
                        value={(config as any)[field.key] ?? ""}
                        onChange={e => update(field.key as keyof Config, e.target.value)}
                        placeholder={field.placeholder}
                        className="bg-white text-slate-900 placeholder:text-slate-400"
                      />
                      {field.help && <span className="font-normal text-slate-500 break-words">{field.help}</span>}
                    </label>
                  ))}
                </div>

                {result[group.id] && (
                  <div className={`mt-4 rounded-xl border p-3 flex gap-2 text-xs leading-5 break-all ${result[group.id].ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                    {result[group.id].ok ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <CircleAlert className="size-4 shrink-0 mt-0.5" />}
                    {result[group.id].message}
                  </div>
                )}
              </div>

              <div className="mt-5 pt-5 border-t border-slate-200/50 flex justify-end gap-2">
                <Button size="sm" variant="outline" className="bg-white" onClick={() => save(group.id).then(() => test(group.id))} disabled={saving === group.id || testing === group.id}>
                  {testing === group.id ? <Loader2 className="size-3.5 animate-spin" /> : <TestTube2 className="size-3.5" />} Test &amp; Save
                </Button>
                <Button size="sm" onClick={() => save(group.id)} disabled={saving === group.id} className="bg-slate-900 text-white hover:bg-slate-800">
                  {saving === group.id ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save Only
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}