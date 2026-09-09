"use client";

import { useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  Play,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Action = "status" | "ctm" | "fmm" | "int-cons" | "rms";
const actions: Array<{ id: Action; label: string; description: string }> = [
  {
    id: "status",
    label: "Check FMM status",
    description: "Calls the Local FMM job-status API without starting a job.",
  },
  {
    id: "ctm",
    label: "Start CTM",
    description: "Calls the Local CTM batch-start API.",
  },
  {
    id: "fmm",
    label: "Start FMM",
    description: "Calls the Local FMM batch-start API.",
  },
  {
    id: "int-cons",
    label: "Start Int-Cons",
    description: "Calls the Local Int-Cons batch-start API.",
  },
  {
    id: "rms",
    label: "Start RMS",
    description: "Calls the Local RMS batch-start API.",
  },
];

export function LocalBesSession() {
  const [selected, setSelected] = useState<(typeof actions)[number] | null>(
    null,
  );
  const [username, setUsername] = useState("supuser");
  const [password, setPassword] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobName, setJobName] = useState("");
  const [jobParams, setJobParams] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  async function run() {
    if (!selected || !username.trim() || !password) return;
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch("http://localhost:8788/local-bes/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: selected.id,
          username: username.trim(),
          password,
          jobId: jobId.trim(),
          jobName: jobName.trim(),
          jobParams: jobParams.trim(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        status?: number;
      };
      const message =
        payload.message ||
        `Local BES returned HTTP ${payload.status ?? response.status}.`;
      const ok = Boolean(response.ok && payload.ok);
      setResult({ ok, message });
      if (ok) toast.success(`${selected.label} completed`);
      else toast.error(message);
    } catch {
      const message =
        "The Local BES connector is not reachable. Start it with npm run local-agent, then try again.";
      setResult({ ok: false, message });
      toast.error(message);
    } finally {
      setRunning(false);
      setPassword("");
    }
  }
  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-cyan-800">
            <ShieldCheck className="size-5" />
            <h2 className="text-sm font-semibold">Local BES test session</h2>
          </div>
          <p className="mt-2 text-xs leading-5 text-cyan-950">
            Use this only while the website and your BES containers are running
            on your computer. Each action signs in through your local BES-API
            first, uses the returned session once, and never saves credentials
            or the session in Settings, browser storage, or the project
            database.
          </p>
        </div>
        <span className="w-fit rounded-full border border-cyan-200 bg-white px-3 py-1 text-[11px] font-semibold text-cyan-800">
          Local only
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant={action.id === "status" ? "outline" : "default"}
            className={
              action.id === "status"
                ? "border-cyan-300 bg-white text-cyan-900 hover:bg-cyan-100"
                : "bg-cyan-700 text-white hover:bg-cyan-800"
            }
            onClick={() => {
              setResult(null);
              setJobId("");
              setJobName("");
              setJobParams("");
              setSelected(action);
            }}
          >
            <Play className="size-3.5" />
            {action.label}
          </Button>
        ))}
      </div>
      {result && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-xs leading-5 ${result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-rose-200 bg-rose-50 text-rose-950"}`}
        >
          {result.ok ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : (
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-600" />
          )}
          <p>{result.message}</p>
        </div>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !running) {
            setSelected(null);
            setPassword("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.label}</DialogTitle>
            <DialogDescription>
              {selected?.description} The connector first signs in through
              BES-API on port 9000, obtains a new sessionId, then forwards it to
              the selected local batch service.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2">
            <span className="text-xs font-semibold text-slate-700">
              Local BES API username
            </span>
            <Input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="supuser"
            />
            <span className="text-[11px] leading-4 text-slate-500">
              This is sent only to your local BES-API login endpoint and is
              never saved in Settings, browser storage, or the project database.
            </span>
          </label>
          <label className="mt-3 grid gap-2">
            <span className="text-xs font-semibold text-slate-700">
              Local BES API password
            </span>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your local password"
            />
          </label>
          {selected?.id === "status" ? (
            <label className="mt-3 grid gap-2">
              <span className="text-xs font-semibold text-slate-700">
                FMM job ID
              </span>
              <Input
                value={jobId}
                onChange={(event) => setJobId(event.target.value)}
                placeholder="For example: 40"
              />
            </label>
          ) : (
            <div className="mt-3 grid gap-3">
              <label className="grid gap-2">
                <span className="text-xs font-semibold text-slate-700">
                  Job name
                </span>
                <Input
                  value={jobName}
                  onChange={(event) => setJobName(event.target.value)}
                  placeholder="For example: CF62_ExpeditedAppMissedVerifications"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-semibold text-slate-700">
                  Job parameters
                </span>
                <Input
                  value={jobParams}
                  onChange={(event) => setJobParams(event.target.value)}
                  placeholder="runDate=YYYY-MM-DD,v=2"
                />
              </label>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={running}
              onClick={() => {
                setSelected(null);
                setPassword("");
              }}
            >
              Cancel
            </Button>
            <Button
              className="bg-cyan-700 text-white hover:bg-cyan-800"
              disabled={
                running ||
                !username.trim() ||
                !password ||
                (selected?.id === "status"
                  ? !jobId.trim()
                  : !jobName.trim() || !jobParams.trim())
              }
              onClick={() => void run()}
            >
              {running ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Run local test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
