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
const cards = [
  {
    id: "oracle",
    title: "Oracle",
    icon: Database,
    detail: "Validates this environment's configured Oracle connection.",
  },
  {
    id: "mongo",
    title: "MongoDB",
    icon: Database,
    detail: "Validates this environment's configured MongoDB connection.",
  },
  {
    id: "logs",
    title: "Container logs",
    icon: FileText,
    detail: "Reads recent output from your named Podman containers.",
  },
  {
    id: "gcs",
    title: "Google Cloud Storage",
    icon: Cloud,
    detail:
      "Uses your signed-in company Google Cloud CLI account for GCS files and reports.",
  },
  {
    id: "cloud-logs",
    title: "Google Cloud Logging",
    icon: Cloud,
    detail:
      "Uses that same Google Cloud CLI account to search Log Explorer entries for this environment.",
  },
  {
    id: "cloud-logs-analytics",
    title: "Exact log analytics",
    icon: Cloud,
    detail:
      "Optional approved analytics source for exact 24-hour counts and severity totals. Leave empty until the platform team provides it.",
  },
  {
    id: "rmj",
    title: "RunMyJobs",
    icon: Server,
    detail:
      "Reads the configured scheduler jobs endpoint for this environment.",
  },
] as const;

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
    "DEV1",
    "DEV2",
    "HAN1",
    "INT1",
    "SIT1",
    "TIM1",
    "NP_PER1",
    "TRN1",
    "TRN2",
  ].includes(environment);
  const isProduction = ["UAT1", "PROD_TIM3", "PER1", "STG1"].includes(
    environment,
  );
  const [config, setConfig] = useState<Config>(blank);
  const [savedProfiles, setSavedProfiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});
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
      toast.message(
        "Start npm run local-agent to configure Local BES connections.",
      );
    } finally {
      setLoading(false);
    }
  }, [environment]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function save() {
    setSaving(true);
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
      toast.success("Local connector settings saved on this computer");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Unable to save local settings.",
      );
    } finally {
      setSaving(false);
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
    <div className="space-y-5">
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
              VPN is required only for direct Oracle and MongoDB requests.
              RunMyJobs, Google Cloud Storage, and Cloud Logging connect
              directly using their configured account access.
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw
                className={`size-4 ${loading ? "animate-spin" : ""}`}
              />
              Reload
            </Button>
          </div>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {cards
            .filter((card) => environment === "LOCAL" || card.id !== "logs")
            .map((card) => {
              const Icon = card.icon;
              const item = result[card.id];
              return (
                <div
                  key={card.id}
                  className="ops-connection-module rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3">
                      <div className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-700">
                        <Icon className="size-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {card.title}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {card.detail}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void test(card.id)}
                      disabled={testing != null}
                    >
                      {testing === card.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <TestTube2 className="size-3.5" />
                      )}
                      Test
                    </Button>
                  </div>
                  {item && (
                    <p
                      className={`mt-3 flex gap-1.5 text-xs leading-5 ${item.ok ? "text-emerald-700" : "text-rose-700"}`}
                    >
                      {item.ok ? (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                      ) : (
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                      )}
                      {item.message}
                    </p>
                  )}
                </div>
              );
            })}
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            Oracle connect string
            <Input
              value={config.oracleConnectString}
              onChange={(e) => update("oracleConnectString", e.target.value)}
              placeholder="host:port/service"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            Oracle user
            <Input
              value={config.oracleUser}
              onChange={(e) => update("oracleUser", e.target.value)}
              placeholder="Read-only local user"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            Oracle password
            <Input
              type="password"
              autoComplete="off"
              value={config.oraclePassword ?? ""}
              onChange={(e) => update("oraclePassword", e.target.value)}
              placeholder="Saved only by local connector"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            MongoDB URL
            <Input
              value={config.mongoUrl}
              onChange={(e) => update("mongoUrl", e.target.value)}
              placeholder="mongodb://localhost:27017/database"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700 md:col-span-2">
            RunMyJobs jobs URL
            <Input
              value={config.rmjJobsUrl}
              onChange={(e) => update("rmjJobsUrl", e.target.value)}
              placeholder="https://.../rest/v1/jobs"
            />
            <span className="font-normal text-slate-500">
              The direct read-only jobs endpoint for this selected environment.
            </span>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700 md:col-span-2">
            RunMyJobs API token
            <Input
              type="password"
              autoComplete="off"
              value={config.rmjToken ?? ""}
              onChange={(e) => update("rmjToken", e.target.value)}
              placeholder="Saved only by the connector on this computer"
            />
          </label>
          {!isNonProd && (
            <>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
                Container command
                <Input
                  value={config.podmanCommand}
                  onChange={(e) => update("podmanCommand", e.target.value)}
                  placeholder="podman"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
                Log containers
                <Input
                  value={config.logContainers}
                  onChange={(e) => update("logContainers", e.target.value)}
                  placeholder="container-a,container-b"
                />
              </label>
            </>
          )}
          {isNonProd && (
            <>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
                Oracle client command
                <Input
                  value={config.oracleClientCommand ?? ""}
                  onChange={(e) =>
                    update("oracleClientCommand", e.target.value)
                  }
                  placeholder="sqlplus"
                />
                <span className="font-normal text-slate-500">
                  Runs directly from this computer over VPN. Provide the full
                  sqlplus path if it is not on PATH.
                </span>
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
                MongoDB client command
                <Input
                  value={config.mongoClientCommand ?? ""}
                  onChange={(e) => update("mongoClientCommand", e.target.value)}
                  placeholder="mongosh"
                />
                <span className="font-normal text-slate-500">
                  Runs directly from this computer over VPN.
                </span>
              </label>
            </>
          )}
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            Google Cloud project
            <Input
              value={config.gcsProject}
              onChange={(e) => update("gcsProject", e.target.value)}
              placeholder={isProduction ? "Add production project" : "bes-np"}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            GCS bucket
            <Input
              value={config.gcsBucket}
              onChange={(e) => update("gcsBucket", e.target.value)}
              placeholder={
                isProduction
                  ? "Add production bucket"
                  : "dhs-bes-np-gcs-intcons-to-process"
              }
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            Reports prefix
            <Input
              value={config.gcsReportsPrefix}
              onChange={(e) => update("gcsReportsPrefix", e.target.value)}
              placeholder={
                isProduction
                  ? "Add production reports prefix"
                  : "BatchControlReport/"
              }
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            Inbound prefix
            <Input
              value={config.gcsInboundPrefix}
              onChange={(e) => update("gcsInboundPrefix", e.target.value)}
              placeholder={
                isProduction ? "Add production inbound prefix" : "INBOUND/"
              }
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            Outbound prefix
            <Input
              value={config.gcsOutboundPrefix}
              onChange={(e) => update("gcsOutboundPrefix", e.target.value)}
              placeholder={
                isProduction ? "Add production outbound prefix" : "OUTBOUND/"
              }
            />
          </label>
          <div className="grid gap-1.5 text-xs font-semibold text-slate-700">
            <span>Google Cloud access</span>
            <span className="font-normal text-slate-500">
              The signed-in company Google Cloud CLI account is shared by Files
              &amp; Reports, GCS Files, and Cloud Logs. Run gcloud auth login on
              this computer before testing.
            </span>
          </div>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700 md:col-span-2">
            Optional exact-count analytics endpoint
            <Input
              value={config.logAnalyticsEndpoint ?? ""}
              onChange={(e) => update("logAnalyticsEndpoint", e.target.value)}
              placeholder="Provided by the platform team when full-range analytics is approved"
            />
            <span className="font-normal text-slate-500">
              Keep this blank for normal Log Explorer viewing. When an approved
              endpoint is provided later, the Cloud Logs page will use it for
              exact totals while still using your company Google Cloud account.
            </span>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700 md:col-span-2">
            Analytics access token
            <Input
              type="password"
              autoComplete="off"
              value={config.logAnalyticsToken ?? ""}
              onChange={(e) => update("logAnalyticsToken", e.target.value)}
              placeholder="Only if the approved analytics endpoint requires it"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700 md:col-span-2">
            Google Cloud CLI command (only if Test cannot find gcloud)
            <Input
              value={config.gcloudCommand}
              onChange={(e) => update("gcloudCommand", e.target.value)}
              placeholder={
                "C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"
              }
            />
            <span className="font-normal text-slate-500">
              Leave this blank first. On Windows the connector automatically
              uses gcloud.cmd. Add the full path only if your terminal still
              reports that Google Cloud CLI cannot be found.
            </span>
          </label>
        </div>
        <div className="mt-5 flex justify-end">
          <Button
            className="bg-cyan-700 text-white hover:bg-cyan-800"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save{" "}
            {environment === "LOCAL"
              ? "Local"
              : environment.replace(/^(NP_|PROD_)/, "")}{" "}
            settings
          </Button>
        </div>
      </section>
    </div>
  );
}
