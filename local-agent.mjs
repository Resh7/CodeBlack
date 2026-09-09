import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PORT = Number(process.env.LOCAL_BES_AGENT_PORT || 8788);
const exec = promisify(execFile);
const configFile = resolve(process.cwd(), ".local-bes-config.json");
const defaults = {
  oracleConnectString: "localhost:1521/FCM_LOCAL",
  oracleUser: "BES",
  oraclePassword: "password",
  mongoUrl: "mongodb://bes:mongodb@localhost:27017/besAudit?authSource=admin",
  rmjJobsUrl: "",
  rmjToken: "",
  podmanCommand: "podman",
  logContainers: "oracledb,mongodb,mock-boomi-ws",
  gcsProject: "",
  gcsBucket: "dhs-bes-np-gcs-intcons-to-process-local",
  gcsPrefix: "",
  gcsReportsPrefix: "BatchControlReport/LOCAL/",
  gcsInboundPrefix: "INBOUND/LOCAL/",
  gcsOutboundPrefix: "OUTBOUND/LOCAL/",
  gcloudCommand: "R:\\Cloud\\google-cloud-sdk\\bin\\gcloud.ps1",
  // Optional platform-provided read-only analytics endpoint. This is separate
  // from gcloud logging read and is used only when it can return exact totals
  // for a complete time range.
  logAnalyticsEndpoint: "",
  logAnalyticsToken: "",
  gcsEndpoint: "",
  gcsCredentialPath: "",
  oracleClientCommand: "",
  mongoClientCommand: "",
};
const gcsListCache = new Map();
const gcsPageCache = new Map();
const gcsAccessTokenCache = { token: "", expiresAt: 0 };
const nonProdGcsDefaults = {
  gcsProject: "bes-np",
  gcsBucket: "dhs-bes-np-gcs-intcons-to-process",
  gcsReportsPrefix: "BatchControlReport/",
  gcsInboundPrefix: "INBOUND/",
  gcsOutboundPrefix: "OUTBOUND/",
  oracleClientCommand: "sqlplus",
  mongoClientCommand: "mongosh",
};
function environmentFolder(environment) {
  return String(environment || "")
    .replace(/^NP_/, "")
    .replace(/^PROD_/, "");
}
function isNonProdEnvironment(environment) {
  return [
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
}
function nonProdProfileDefaults(environment) {
  const folder = environmentFolder(environment);
  return {
    ...nonProdGcsDefaults,
    gcsReportsPrefix: `BatchControlReport/${folder}/`,
    gcsInboundPrefix: `INBOUND/${folder}/`,
    gcsOutboundPrefix: `OUTBOUND/${folder}/`,
  };
}
const actions = {
  status: {
    method: "GET",
    url: "http://127.0.0.1:9011/api/fmm/batch/getJobStatus",
    label: "FMM job status",
  },
  ctm: {
    method: "POST",
    url: "http://127.0.0.1:9050/api/ctm/batch/start",
    label: "CTM batch start",
  },
  fmm: {
    method: "POST",
    url: "http://127.0.0.1:9011/api/fmm/batch/start",
    label: "FMM batch start",
  },
  "int-cons": {
    method: "POST",
    url: "http://127.0.0.1:9090/api/int-cons/batch/start",
    label: "Int-Cons batch start",
  },
  rms: {
    method: "POST",
    url: "http://127.0.0.1:9011/api/rms/batch/start",
    label: "RMS batch start",
  },
};
function runWithInput(command, args, input, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `${command} timed out after ${Math.round(timeout / 1000)} seconds.`,
        ),
      );
    }, timeout);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${stderr || stdout || `${command} exited with code ${code}`}`.trim(),
          ),
        );
    });
    child.stdin.end(input);
  });
}
function normalizeBesSessionCookie(value) {
  const input = String(value || "")
    .trim()
    .replace(/^set-cookie\s*:\s*/i, "");
  const sessionPair = input
    .split(";")
    .map((part) => part.trim())
    .find((part) => /^sessionid\s*=/i.test(part));
  if (!sessionPair)
    throw new Error(
      "Paste the sessionId cookie from the login response, for example sessionId=... The full Set-Cookie value is also accepted.",
    );
  const valuePart = sessionPair.slice(sessionPair.indexOf("=") + 1).trim();
  if (!valuePart) throw new Error("The sessionId cookie value is empty.");
  return `sessionId=${valuePart}`;
}
async function createBesSession(username, password) {
  if (typeof username !== "string" || !username.trim())
    throw new Error("Enter the local BES API username.");
  if (typeof password !== "string" || !password)
    throw new Error("Enter the local BES API password.");
  const loginUrl = new URL("http://127.0.0.1:9000/api/login");
  loginUrl.searchParams.set("username", username.trim());
  loginUrl.searchParams.set("password", password);
  const login = await fetch(loginUrl, {
    method: "POST",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!login.ok)
    throw new Error(`BES API login returned HTTP ${login.status}.`);
  const setCookies =
    typeof login.headers.getSetCookie === "function"
      ? login.headers.getSetCookie()
      : [login.headers.get("set-cookie") || ""];
  const sessionCookie = setCookies.find((value) =>
    /^sessionid\s*=/i.test(value),
  );
  if (!sessionCookie)
    throw new Error(
      "BES API login succeeded but did not return a sessionId cookie. Confirm BES-API is running on localhost:9000.",
    );
  return normalizeBesSessionCookie(sessionCookie);
}
function safeReadOnlySql(query) {
  const statement = String(query || "")
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .replace(/;\s*$/, "");
  if (!statement) throw new Error("The saved validation query is empty.");
  if (statement.length > 50_000)
    throw new Error("Validation query exceeds the 50 KB local safety limit.");
  if (statement.includes(";"))
    throw new Error("Only one SQL statement is allowed.");
  if (!/^(select|with)\b/i.test(statement))
    throw new Error(
      "Local validation execution allows only SELECT or WITH queries.",
    );
  if (
    /\b(insert|update|delete|merge|alter|drop|truncate|create|grant|revoke|execute|call|commit|rollback)\b/i.test(
      statement,
    )
  )
    throw new Error("Write or administration SQL is not allowed.");
  return statement;
}
async function executeOracleValidation(config, query, businessDate) {
  if (
    !config.oracleConnectString ||
    !config.oracleUser ||
    !config.oraclePassword
  )
    throw new Error(
      "Save the local Oracle connect string, user, and password in Settings first.",
    );
  const statement = safeReadOnlySql(query)
    // Workbook authors sometimes omit the colon on the app-provided runDate bind.
    // Normalize only this known TO_DATE argument, without changing query logic.
    .replace(/TO_DATE\s*\(\s*runDate\b/gi, "TO_DATE(:runDate");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate || "")))
    throw new Error(
      "Choose a valid business date before running a local validation.",
    );
  const connect = String(config.oracleConnectString).replace(
    /^jdbc:oracle:thin:@\/\//,
    "",
  );
  try {
    const oracleInput = `SET PAGESIZE 1000\nSET LINESIZE 2000\nSET FEEDBACK ON\nSET HEADING ON\nWHENEVER SQLERROR EXIT SQL.SQLCODE\nVARIABLE runDate VARCHAR2(10)\nBEGIN :runDate := '${businessDate}'; END;\n/\n${statement};\nEXIT;\n`;
    const { stdout, stderr } = config.oracleClientCommand
      ? await runWithInput(
          config.oracleClientCommand,
          ["-s", `${config.oracleUser}/${config.oraclePassword}@${connect}`],
          oracleInput,
          30_000,
        )
      : await exec(
          config.podmanCommand || "podman",
          [
            "exec",
            "-e",
            `ORACLE_USER=${config.oracleUser}`,
            "-e",
            `ORACLE_PASSWORD=${config.oraclePassword}`,
            "-e",
            `ORACLE_CONNECT=${connect}`,
            "-e",
            `BUSINESS_DATE=${businessDate}`,
            "-e",
            `SQL_QUERY=${statement}`,
            "oracledb",
            "bash",
            "-lc",
            "printf 'SET PAGESIZE 1000\\nSET LINESIZE 2000\\nSET FEEDBACK ON\\nSET HEADING ON\\nWHENEVER SQLERROR EXIT SQL.SQLCODE\\nVARIABLE runDate VARCHAR2(10)\\nBEGIN :runDate := '\''%s'\''; END;\\n/\\n%s;\\nEXIT;\\n' \"$BUSINESS_DATE\" \"$SQL_QUERY\" | sqlplus -s \"$ORACLE_USER/$ORACLE_PASSWORD@$ORACLE_CONNECT\"",
          ],
          { timeout: 30_000, maxBuffer: 1024 * 1024 },
        );
    const output = `${stdout}\n${stderr}`.trim();
    const rows = output.match(/(\d+) rows? selected\./i);
    return {
      rowCount: rows ? Number(rows[1]) : null,
      preview: output.slice(0, 2000),
    };
  } catch (error) {
    const detail = `${error?.stdout || ""}\n${error?.stderr || ""}`.trim();
    throw new Error(
      detail.slice(0, 1600) ||
        (error instanceof Error ? error.message : "Oracle validation failed."),
    );
  }
}
function safeMongoQuery(query) {
  const statement = String(query || "")
    .trim()
    .replace(/;\s*$/, "");
  if (!statement) throw new Error("The saved MongoDB query is empty.");
  if (statement.length > 50_000)
    throw new Error("MongoDB query exceeds the 50 KB safety limit.");
  if (
    /\b(insert|update|delete|remove|drop|create|rename|bulkWrite|replaceOne|replaceMany|findOneAndUpdate|findOneAndDelete|\$out|\$merge)\b/i.test(
      statement,
    )
  ) {
    throw new Error(
      "MongoDB write and administration commands are not allowed.",
    );
  }
  if (!/^(db\.|\[|\{)/.test(statement))
    throw new Error(
      "Enter a read-only MongoDB expression, for example db.collection.find({}).toArray().",
    );
  return statement;
}
async function executeMongoValidation(config, query) {
  if (!config.mongoUrl)
    throw new Error("Save the MongoDB URL in Settings first.");
  const expression = safeMongoQuery(query);
  const script = `const result = (${expression}); const rows = Array.isArray(result) ? result : (result && typeof result.toArray === 'function' ? result.toArray() : result); print(JSON.stringify(rows));`;
  const command = config.mongoClientCommand || "mongosh";
  const { stdout, stderr } = config.mongoClientCommand
    ? await exec(command, [config.mongoUrl, "--quiet", "--eval", script], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      })
    : await exec(
        config.podmanCommand || "podman",
        [
          "exec",
          "mongodb",
          "mongosh",
          config.mongoUrl,
          "--quiet",
          "--eval",
          script,
        ],
        { timeout: 30_000, maxBuffer: 1024 * 1024 },
      );
  const output = `${stdout}\n${stderr}`.trim();
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    parsed = null;
  }
  return {
    rowCount: Array.isArray(parsed)
      ? parsed.length
      : typeof parsed === "number"
        ? parsed
        : parsed == null
          ? null
          : 1,
    preview: output.slice(0, 2000),
  };
}
function validEnvironment(value) {
  return /^[A-Z0-9_]{2,24}$/.test(String(value || ""))
    ? String(value)
    : "LOCAL";
}
async function readAllConfigs() {
  try {
    const saved = JSON.parse(await readFile(configFile, "utf8"));
    if (
      saved &&
      typeof saved === "object" &&
      saved.profiles &&
      typeof saved.profiles === "object"
    )
      return saved;
    return { profiles: { LOCAL: { ...defaults, ...(saved || {}) } } };
  } catch {
    return { profiles: { LOCAL: { ...defaults } } };
  }
}
async function readConfig(environment = "LOCAL") {
  const all = await readAllConfigs();
  const selected = validEnvironment(environment);
  const profile = all.profiles?.[selected] || {};
  const recommended = isNonProdEnvironment(selected)
    ? nonProdProfileDefaults(selected)
    : {};
  return {
    ...defaults,
    ...recommended,
    ...profile,
    ...(isNonProdEnvironment(selected)
      ? {
          gcsProject: "bes-np",
          gcsBucket: "dhs-bes-np-gcs-intcons-to-process",
          gcsReportsPrefix: `BatchControlReport/${environmentFolder(selected)}/`,
          gcsInboundPrefix: `INBOUND/${environmentFolder(selected)}/`,
          gcsOutboundPrefix: `OUTBOUND/${environmentFolder(selected)}/`,
        }
      : {}),
  };
}
function publicConfig(config) {
  return {
    ...config,
    oraclePassword: "",
    rmjToken: "",
    logAnalyticsToken: "",
  };
}
function localConnectionHealth(config) {
  return {
    rmj: Boolean(config.rmjJobsUrl && config.rmjToken),
    "cloud-logs": Boolean(config.gcsProject && config.gcloudCommand),
    gcs: Boolean(config.gcsBucket && config.gcloudCommand),
    oracle: Boolean(
      config.oracleConnectString && config.oracleUser && config.oraclePassword,
    ),
    mongo: Boolean(config.mongoUrl),
  };
}
async function handleRmjJobs(request, response, config) {
  const url = new URL(
    request.url,
    `http://${request.headers.host || "localhost"}`,
  );
  const jobsUrl = String(config.rmjJobsUrl || "").trim();
  if (!jobsUrl)
    throw new Error(
      "Enter the RunMyJobs jobs URL and save this environment profile first.",
    );
  const upstream = new URL(jobsUrl);
  for (const name of ["businessDate", "q", "status"]) {
    const value = url.searchParams.get(name)?.trim();
    if (value) upstream.searchParams.set(name, value);
  }
  const headers = { Accept: "application/json" };
  if (config.rmjToken) headers.Authorization = `Bearer ${config.rmjToken}`;
  const result = await fetch(upstream, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await result.text();
  if (!result.ok)
    throw new Error(
      `RunMyJobs returned HTTP ${result.status}: ${text.slice(0, 300)}`,
    );
  const payload = text ? JSON.parse(text) : {};
  const collection = Array.isArray(payload)
    ? payload
    : [
        payload.items,
        payload.results,
        payload.data,
        payload.jobs,
        payload.content,
      ].find(Array.isArray) || [];
  const jobs = collection.map((item) => ({
    id: String(item.id ?? item.jobId ?? item.job_id ?? item.jobRunId ?? ""),
    name: String(
      item.name ??
        item.jobName ??
        item.job_name ??
        item.definitionName ??
        "Unnamed job",
    ),
    definition: item.definition ?? item.jobDefinition ?? item.definitionName,
    status: item.status ?? item.state ?? item.jobStatus ?? item.executionStatus,
    requestedAt:
      item.requestedAt ?? item.submittedAt ?? item.submitTime ?? item.createdAt,
    startedAt: item.startedAt ?? item.startTime ?? item.startDate,
    endedAt: item.endedAt ?? item.endTime ?? item.endDate,
    returnCode: item.returnCode ?? item.exitCode ?? item.resultCode,
    queue: item.queue ?? item.queueName,
    server: item.server ?? item.serverName ?? item.jobServer,
  }));
  return send(response, 200, {
    jobs,
    fetchedAt: new Date().toISOString(),
    source: "LOCAL_CONNECTOR",
  });
}
function loggingQuoted(value) {
  return `"${String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}
function normalizeLogSeverity(entry) {
  const declared = String(entry?.severity || "").toUpperCase();
  if (declared && declared !== "DEFAULT") return declared;
  const payload = entry?.jsonPayload || {};
  const text = `${entry?.textPayload || ""}\n${payload.message || ""}`
    .replace(/\u001b\[[0-9;]*m/g, "")
    .toUpperCase();
  const match = text.match(
    /\[(EMERGENCY|ALERT|CRITICAL|ERROR|WARNING|WARN|NOTICE|INFO|DEBUG)\]/,
  );
  const severity = match?.[1];
  if (severity === "WARN") return "WARNING";
  return severity || "DEFAULT";
}
function logSummary(entries) {
  return entries.reduce(
    (summary, entry) => {
      const severity = entry.severity || "DEFAULT";
      summary.total += 1;
      if (["ERROR", "CRITICAL", "ALERT", "EMERGENCY"].includes(severity))
        summary.error += 1;
      else if (severity === "WARNING") summary.warning += 1;
      else if (["INFO", "NOTICE"].includes(severity)) summary.info += 1;
      else summary.debug += 1;
      return summary;
    },
    { total: 0, error: 0, warning: 0, info: 0, debug: 0 },
  );
}
async function handleCloudLogs(response, config, environment, input) {
  const namespace = String(
    input.namespace || environmentFolder(environment),
  ).toLowerCase();
  const microservice = String(input.microservice || "").trim();
  if (!microservice)
    throw new Error("Select a microservice before searching logs.");
  const from = input.from ? new Date(input.from) : null;
  const to = input.to ? new Date(input.to) : null;
  if (from && Number.isNaN(from.getTime()))
    throw new Error("Enter a valid start date and time for the log search.");
  if (to && Number.isNaN(to.getTime()))
    throw new Error("Enter a valid end date and time for the log search.");
  if (from && to && from > to)
    throw new Error("The log search start time must be before its end time.");
  const filters = [
    `resource.labels.namespace_name=${loggingQuoted(namespace)}`,
    `labels."k8s-pod/app"=${loggingQuoted(microservice)}`,
  ];
  try {
    // The existing company gcloud account remains the default reader. If the
    // platform team later provides an approved analytics endpoint, it can
    // return exact full-range summary counts without downloading every entry
    // through this local process.
    if (String(config.logAnalyticsEndpoint || "").trim()) {
      const analyticsResponse = await fetch(config.logAnalyticsEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(config.logAnalyticsToken
            ? { Authorization: `Bearer ${config.logAnalyticsToken}` }
            : {}),
        },
        body: JSON.stringify({
          projectId: config.gcsProject,
          environment,
          namespace,
          microservice,
          severity: input.severity || "ALL",
          message: input.message || "",
          jobId: input.jobId || "",
          traceId: input.traceId || "",
          sessionId: input.sessionId || "",
          from: from?.toISOString() || null,
          to: to?.toISOString() || null,
          pageSize: Math.min(Math.max(Number(input.pageSize) || 100, 1), 100),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const analyticsPayload = await analyticsResponse.json().catch(() => ({}));
      if (!analyticsResponse.ok)
        throw new Error(
          analyticsPayload.error ||
            `Log analytics returned HTTP ${analyticsResponse.status}.`,
        );
      const analyticsEntries = Array.isArray(analyticsPayload.entries)
        ? analyticsPayload.entries
        : [];
      return send(response, 200, {
        entries: analyticsEntries,
        summary: analyticsPayload.summary || logSummary(analyticsEntries),
        fetched: Number(analyticsPayload.fetched || analyticsEntries.length),
        capped: Boolean(analyticsPayload.capped),
        exactCounts: Boolean(analyticsPayload.exactCounts ?? true),
        sourceScope: "FULL_RANGE_ANALYTICS",
        nextPageToken: analyticsPayload.nextPageToken || null,
        source: "APPROVED_LOG_ANALYTICS",
      });
    }
    const limit = Math.min(Math.max(Number(input.pageSize) || 100, 1), 100);
    const searchUntil = to || new Date();
    const freshnessSeconds = Math.min(
      Math.max(
        Math.ceil(
          (searchUntil.getTime() -
            (from || new Date(searchUntil.getTime() - 86_400_000)).getTime()) /
            1000,
        ) + 86_400,
        300,
      ),
      90 * 86_400,
    );
    const rangeMinutes = Math.max(
      Math.ceil(
        (searchUntil.getTime() -
          (from || new Date(searchUntil.getTime() - 15 * 60_000)).getTime()) /
          60_000,
      ),
      1,
    );
    const fetchLimit = Math.min(
      Math.max(rangeMinutes <= 60 ? 500 : 1_000, limit * 5),
      2_000,
    );
    const { stdout } = await runGcloud(
      config,
      [
        "logging",
        "read",
        filters.join(" AND "),
        "--format=json",
        "--order=desc",
        "--limit",
        String(fetchLimit),
        `--freshness=${freshnessSeconds}s`,
      ],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const parsedRows = JSON.parse(stdout || "[]");
    const rows = Array.isArray(parsedRows) ? parsedRows : [];
    const matchedRows = rows.filter((entry) => {
      const timestamp = entry.timestamp ? new Date(entry.timestamp) : null;
      if (from && (!timestamp || timestamp < from)) return false;
      if (to && (!timestamp || timestamp > to)) return false;
      const payload = entry.jsonPayload || {};
      const message = String(
        entry.textPayload || payload.message || JSON.stringify(payload),
      );
      const severity = normalizeLogSeverity(entry);
      if (
        input.severity === "ERROR" &&
        !["ERROR", "CRITICAL", "ALERT", "EMERGENCY"].includes(severity)
      )
        return false;
      if (input.severity === "WARNING" && severity !== "WARNING") return false;
      if (input.severity === "INFO" && !["INFO", "NOTICE"].includes(severity))
        return false;
      if (
        input.severity === "DEBUG" &&
        !["DEBUG", "DEFAULT"].includes(severity)
      )
        return false;
      if (
        input.message?.trim() &&
        !message.toLowerCase().includes(input.message.trim().toLowerCase())
      )
        return false;
      if (
        input.jobId?.trim() &&
        !JSON.stringify(payload).includes(input.jobId.trim())
      )
        return false;
      if (
        input.traceId?.trim() &&
        !String(entry.trace || "").includes(input.traceId.trim())
      )
        return false;
      if (
        input.sessionId?.trim() &&
        !JSON.stringify(payload).includes(input.sessionId.trim())
      )
        return false;
      return true;
    });
    const mappedEntries = matchedRows.map((entry) => {
      const resource = entry.resource || {};
      const labels = entry.labels || {};
      const jsonPayload = entry.jsonPayload || {};
      return {
        timestamp: entry.timestamp,
        severity: normalizeLogSeverity(entry),
        projectId: config.gcsProject,
        namespace: resource.labels?.namespace_name || namespace,
        microservice: labels["k8s-pod/app"] || microservice,
        pod: resource.labels?.pod_name || "",
        container: resource.labels?.container_name || "",
        message:
          entry.textPayload ||
          jsonPayload.message ||
          JSON.stringify(jsonPayload),
        trace: entry.trace || "",
        spanId: entry.spanId || "",
        logName: entry.logName || "",
        insertId: entry.insertId || "",
        jsonPayload,
      };
    });
    const summary = logSummary(mappedEntries);
    const entries = mappedEntries.slice(0, limit);
    return send(response, 200, {
      entries,
      summary,
      fetched: mappedEntries.length,
      capped: rows.length >= fetchLimit,
      exactCounts: false,
      sourceScope: "LOADED_PAGE",
      nextPageToken: null,
      source: "LOCAL_GCLOUD",
    });
  } catch (error) {
    throw gcloudError(error);
  }
}
function gcsPrefix(value) {
  return String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}
function localGcsRoots(config, scope = "all") {
  const reports = gcsPrefix(
    config.gcsReportsPrefix || "BatchControlReport/LOCAL/",
  );
  const inbound = gcsPrefix(config.gcsInboundPrefix || "INBOUND/LOCAL/");
  const outbound = gcsPrefix(config.gcsOutboundPrefix || "OUTBOUND/LOCAL/");
  return scope === "reports"
    ? [reports]
    : scope === "inbound"
      ? [inbound]
      : scope === "outbound"
        ? [outbound]
        : scope === "transfers"
          ? [inbound, outbound]
          : [reports, inbound, outbound];
}
function gcsUri(config, name = "") {
  const bucket = String(config.gcsBucket || "").trim();
  if (!bucket) throw new Error("Enter a GCS bucket, then save Local settings.");
  const object = String(name || "").replace(/^\/+/, "");
  if (
    object &&
    !localGcsRoots(config).some(
      (root) => object === root || object.startsWith(`${root}/`),
    )
  )
    throw new Error(
      "That object is outside the approved Reports, INBOUND, and OUTBOUND prefixes.",
    );
  return `gs://${bucket}${object ? `/${object}` : ""}`;
}
function gcloudArgs(config, args) {
  return config.gcsProject ? ["--project", config.gcsProject, ...args] : args;
}
function quotePowerShellArg(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
function powerShellExecutable() {
  return process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : "powershell.exe";
}
function powerShellGcloudCommand(executable, args) {
  return `& ${[executable, ...args].map(quotePowerShellArg).join(" ")}`;
}
function gcloudExecutable(config) {
  return (
    String(config.gcloudCommand || "").trim() ||
    (process.platform === "win32" ? "gcloud.cmd" : "gcloud")
  );
}
function runGcloud(config, args, options) {
  const executable = gcloudExecutable(config);
  const commandArgs = gcloudArgs(config, args);
  if (process.platform === "win32")
    return exec(
      powerShellExecutable(),
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        powerShellGcloudCommand(executable, commandArgs),
      ],
      options,
    );
  return exec(executable, commandArgs, options);
}
function spawnGcloud(config, args) {
  const executable = gcloudExecutable(config);
  const commandArgs = gcloudArgs(config, args);
  if (process.platform === "win32")
    return spawn(
      powerShellExecutable(),
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        powerShellGcloudCommand(executable, commandArgs),
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
  return spawn(executable, commandArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}
async function getGcsAccessToken(config) {
  if (gcsAccessTokenCache.token && gcsAccessTokenCache.expiresAt > Date.now())
    return gcsAccessTokenCache.token;
  const { stdout } = await runGcloud(config, ["auth", "print-access-token"], {
    timeout: 15_000,
  });
  const token = String(stdout || "").trim();
  if (!token) throw new Error("Google Cloud authentication is not available.");
  gcsAccessTokenCache.token = token;
  gcsAccessTokenCache.expiresAt = Date.now() + 45 * 60_000;
  return token;
}
async function listGcsPage(config, options = {}) {
  const prefix = String(options.prefix || "");
  const delimiter = String(options.delimiter || "");
  const pageToken = String(options.pageToken || "");
  const refresh = Boolean(options.refresh);
  const cacheKey = [
    config.gcsProject,
    config.gcsBucket,
    prefix,
    delimiter,
    pageToken,
  ].join("|");
  const cached = gcsPageCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 5 * 60_000 && !refresh)
    return cached.value;
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(config.gcsBucket)}/o`,
  );
  url.searchParams.set("prefix", prefix);
  url.searchParams.set("maxResults", "1000");
  if (delimiter) url.searchParams.set("delimiter", delimiter);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await getGcsAccessToken(config)}` },
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || "Unable to list Google Cloud Storage objects.");
  }
  const value = await response.json();
  gcsPageCache.set(cacheKey, { createdAt: Date.now(), value });
  return value;
}
function gcloudError(error) {
  if (
    error &&
    (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
      /maxBuffer|max buffer/i.test(error.message || ""))
  )
    return new Error(
      "This log search returned too much data. Select a shorter time range, a severity, or a more specific message before searching again.",
    );
  if (
    error &&
    (error.code === "ENOENT" || /spawn gcloud/i.test(error.message || ""))
  )
    return new Error(
      "Google Cloud CLI was not found by the local connector. Restart npm run local-agent from the PowerShell where gcloud works, or set the optional Google Cloud CLI command to the full gcloud.cmd path.",
    );
  const detail = `${error?.stderr || ""}\n${error?.stdout || ""}`.trim();
  if (detail) return new Error(detail.slice(0, 1600));
  return error instanceof Error
    ? error
    : new Error("Google Cloud CLI request failed.");
}
function isTextObject(name) {
  return /\.(?:txt|log|csv|json|xml|yaml|yml|sql|out|err)$/i.test(name);
}
function contentType(name) {
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.svg$/i.test(name)) return "image/svg+xml";
  if (/\.xml$/i.test(name)) return "application/xml";
  if (/\.ya?ml$/i.test(name)) return "text/yaml";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.(?:log|txt|out|err|sql)$/i.test(name)) return "text/plain";
  return "application/octet-stream";
}
function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
function formatColumnName(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function csvFromRows(headers, rows) {
  return [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n") + "\r\n";
}
function splitReportColumns(line) {
  const text = String(line || "").trim();
  if (!text) return [];
  if (text.includes("\t")) return text.split("\t").map((value) => value.trim());
  if (text.includes("|")) return text.split("|").map((value) => value.trim());
  if (text.includes(",")) return text.split(",").map((value) => value.trim());
  return text.split(/\s{2,}/).map((value) => value.trim());
}
function isReportDivider(line) {
  return /^[*\s_-]+$/.test(String(line || ""));
}
function toRunReportCsv(lines) {
  const headerIndex = lines.findIndex((line) => /case\s*id.*details/i.test(line));
  if (headerIndex < 0) return null;
  const records = [];
  const columns = new Set(["Case ID"]);
  for (const sourceLine of lines.slice(headerIndex + 1)) {
    const line = sourceLine.trim();
    if (!line || isReportDivider(line)) continue;
    const record = {};
    const firstValue = line.match(/^([^,\s]+)\s+(?=\w+\s*=)/);
    if (firstValue) record["Case ID"] = firstValue[1];
    else if (/^\d+$/.test(line)) record["Case ID"] = line;
    const remainder = firstValue ? line.slice(firstValue[0].length) : line;
    const details = splitReportColumns(remainder);
    let detailIndex = 1;
    for (const detail of details) {
      if (!detail) continue;
      const equalAt = detail.indexOf("=");
      if (equalAt > 0) {
        const column = formatColumnName(detail.slice(0, equalAt));
        record[column] = detail.slice(equalAt + 1).trim();
        columns.add(column);
      } else if (!record["Case ID"] && /^\d+$/.test(detail)) {
        record["Case ID"] = detail;
      } else {
        const column = `Detail ${detailIndex++}`;
        record[column] = detail;
        columns.add(column);
      }
    }
    if (Object.keys(record).length) records.push(record);
  }
  if (!records.length) return null;
  const headers = Array.from(columns);
  return csvFromRows(headers, records.map((record) => headers.map((header) => record[header] || "")));
}
function toControlReportCsv(lines) {
  const headerIndex = lines.findIndex((line) => /case\s+number.*error\s+description/i.test(line));
  if (headerIndex < 0) return null;
  const headers = [
    "Error Section",
    "Case Number",
    "Case ID",
    "Client ID",
    "Job Primary",
    "Primary Value",
    "Error Description",
  ];
  const rows = [];
  let section = "Exception details";
  for (const priorLine of lines.slice(0, headerIndex).reverse()) {
    if (/reader\s+errors/i.test(priorLine)) { section = "Reader errors"; break; }
    if (/processor\s+errors/i.test(priorLine)) { section = "Processor errors"; break; }
    if (/writer\s+errors/i.test(priorLine)) { section = "Writer errors"; break; }
  }
  for (const sourceLine of lines.slice(headerIndex + 1)) {
    const line = sourceLine.trim();
    if (!line || isReportDivider(line) || /^none$/i.test(line)) continue;
    if (/reader\s+errors/i.test(line)) { section = "Reader errors"; continue; }
    if (/processor\s+errors/i.test(line)) { section = "Processor errors"; continue; }
    if (/writer\s+errors/i.test(line)) { section = "Writer errors"; continue; }
    const values = splitReportColumns(line);
    if (values.length < 2) continue;
    const fixedValues = values.slice(0, 5);
    const errorDescription = values.slice(5).join(" ");
    while (fixedValues.length < 5) fixedValues.push("");
    rows.push([section, ...fixedValues, errorDescription]);
  }
  return rows.length ? csvFromRows(headers, rows) : null;
}
function toCsv(text, name = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  const kind = reportKind(name);
  const structured =
    kind === "run"
      ? toRunReportCsv(lines)
      : kind === "control"
        ? toControlReportCsv(lines)
        : null;
  if (structured) return structured;
  return csvFromRows(
    ["Report line"],
    lines.map((line) => [line]),
  );
}
function reportKind(name) {
  const normalized = String(name || "")
    .split("/")
    .pop()
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  if (/control\s*report/.test(normalized)) return "control";
  if (/run\s*report/.test(normalized)) return "run";
  return "other";
}
function matchesCount(lines, expression) {
  return lines.reduce(
    (total, line) => total + (expression.test(line) ? 1 : 0),
    0,
  );
}
function explicitRecordCount(text) {
  const counts = [];
  const expressions = [
    /(?:processed|generated|completed|handled)\D{0,35}(\d[\d,]*)\s*(?:records?|rows?|items?)/gi,
    /(\d[\d,]*)\s*(?:records?|rows?|items?)\b.{0,55}\b(?:processed|generated|completed|handled|successful)/gi,
  ];
  for (const expression of expressions) {
    for (const match of text.matchAll(expression)) {
      const value = Number(String(match[1]).replaceAll(",", ""));
      if (Number.isFinite(value)) counts.push(value);
    }
  }
  return counts.length ? Math.max(...counts) : null;
}
function errorFingerprint(line) {
  const clean = String(line || "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][^\s]+\s*/g, "")
    .replace(/^\[[^\]]+\]\s*/g, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>")
    .replace(/\b\d{2,}\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  const marker = clean.search(/\b(error|exception|failed|failure|rejected)\b/i);
  return (marker >= 0 ? clean.slice(marker) : clean).slice(0, 150).trim();
}
function detailedErrorGroups(lines) {
  const groups = new Map();
  for (const line of lines) {
    if (!/\b(error|exception|failed|failure|rejected)\b/i.test(line)) continue;
    const fingerprint = errorFingerprint(line) || "Unclassified error message";
    const current = groups.get(fingerprint) || {
      count: 0,
      sample: String(line).replace(/\s+/g, " ").trim().slice(0, 220),
    };
    current.count += 1;
    groups.set(fingerprint, current);
  }
  return Array.from(groups, ([message, value]) => ({ message, ...value }))
    .sort(
      (left, right) =>
        right.count - left.count || left.message.localeCompare(right.message),
    )
    .slice(0, 5);
}
function analyzeGcsReport(name, text, truncated = false) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const kind = reportKind(name);
  const errorCount = matchesCount(
    lines,
    /\b(error|exception|failed|failure|rejected)\b/i,
  );
  const warningCount = matchesCount(lines, /\b(warn|warning)\b/i);
  const nullCount = matchesCount(lines, /\bnull\b/i);
  const validationFailureCount = matchesCount(
    lines,
    /\b(validation|validation error|validation failed)\b/i,
  );
  const rejectedCount = matchesCount(lines, /\b(rejected|reject)\b/i);
  const timeoutCount = matchesCount(lines, /\b(timeout|timed out)\b/i);
  const explicitCount = explicitRecordCount(text);
  const looksLikeCsv = /\.csv$/i.test(name) && lines.length > 1;
  const recordCount =
    explicitCount ?? (looksLikeCsv ? lines.length - 1 : lines.length);
  const observations = [];
  const errorGroups = detailedErrorGroups(lines);
  if (errorCount) {
    observations.push({
      label: "Error entries found",
      count: errorCount,
      detail:
        "Each distinct error pattern is listed below with the exact message found in the report.",
    });
    for (const group of errorGroups) {
      observations.push({
        label: group.message,
        count: group.count,
        detail: `Example: ${group.sample}`,
      });
    }
  }
  if (nullCount)
    observations.push({
      label: "Null-related entries found",
      count: nullCount,
      detail:
        "These entries mention null data and may need source-data or field-mapping review.",
    });
  if (warningCount)
    observations.push({
      label: "Warning entries found",
      count: warningCount,
      detail:
        "These entries were completed with a warning or require follow-up.",
    });
  if (validationFailureCount)
    observations.push({
      label: "Validation findings",
      count: validationFailureCount,
      detail:
        "These entries reference validation activity or a validation failure.",
    });
  if (rejectedCount)
    observations.push({
      label: "Rejected entries",
      count: rejectedCount,
      detail: "These entries indicate that a record or operation was rejected.",
    });
  if (timeoutCount)
    observations.push({
      label: "Timeout findings",
      count: timeoutCount,
      detail:
        "These entries indicate a timeout and may need a retry or service review.",
    });
  const countDescription = explicitCount
    ? `${explicitCount.toLocaleString()} records were reported as processed or generated`
    : `${recordCount.toLocaleString()} report entries were read`;
  const summary =
    kind === "run"
      ? `${countDescription}. ${errorCount ? `${errorCount.toLocaleString()} error-related entries were found.` : "No error-related entries were found."}`
      : kind === "control"
        ? `The control report contains ${recordCount.toLocaleString()} entries. It includes ${errorCount.toLocaleString()} error-related entries, ${warningCount.toLocaleString()} warnings, and ${nullCount.toLocaleString()} null-related findings.`
        : `The report contains ${recordCount.toLocaleString()} entries. It includes ${errorCount.toLocaleString()} error-related entries, ${warningCount.toLocaleString()} warnings, and ${nullCount.toLocaleString()} null-related findings.`;
  return {
    name:
      String(name || "")
        .split("/")
        .pop() || "Unnamed report",
    reportType: kind,
    recordCount,
    processedCount: kind === "run" ? recordCount : null,
    errorCount,
    warningCount,
    nullCount,
    observations,
    summary,
    truncated,
  };
}
async function listGcs(config, search) {
  const scope = search.get("scope") || "all";
  const roots = localGcsRoots(config, scope);
  const requestedPrefix = gcsPrefix(search.get("prefix"));
  const treeBrowse = search.get("tree") === "1";
  const query = String(search.get("q") || "")
    .trim()
    .toLowerCase();
  const type = search.get("type") || "all";
  const from = search.get("from") || "";
  const to = search.get("to") || "";
  const pageToken = search.get("pageToken") || "";
  const useFastPagedListing =
    ["reports", "inbound", "outbound"].includes(scope) &&
    !query &&
    !from &&
    !to &&
    type === "all" &&
    !treeBrowse;
  if (
    requestedPrefix &&
    !roots.some(
      (root) =>
        requestedPrefix === root || requestedPrefix.startsWith(`${root}/`),
    )
  )
    throw new Error("The requested folder is outside the approved GCS root.");
  const targetRoots = requestedPrefix ? [requestedPrefix] : roots;
  let rows = [];
  let apiFolderPrefixes = [];
  let nextPageToken = null;
  try {
    if (useFastPagedListing) {
      const apiPage = await listGcsPage(config, {
        prefix: `${(requestedPrefix || roots[0] || "").replace(/\/+$/, "")}/`,
        delimiter: requestedPrefix ? "" : "/",
        pageToken: requestedPrefix ? pageToken : "",
        refresh: search.get("refresh") === "1",
      });
      rows = Array.isArray(apiPage.items) ? apiPage.items : [];
      apiFolderPrefixes = Array.isArray(apiPage.prefixes)
        ? apiPage.prefixes.map((item) => gcsPrefix(item))
        : [];
      nextPageToken = requestedPrefix ? apiPage.nextPageToken || null : null;
    } else {
      const cacheKey = [
        config.gcsProject,
        config.gcsBucket,
        ...targetRoots,
      ].join("|");
      const cached = gcsListCache.get(cacheKey);
      if (
        cached &&
        Date.now() - cached.createdAt < 30_000 &&
        search.get("refresh") !== "1"
      ) {
        rows = cached.rows;
      } else {
        const listings = await Promise.all(
          targetRoots.map(async (root) => {
            const gcsPath = `gs://${config.gcsBucket}/${root}`;
            try {
              const { stdout } = await runGcloud(
                config,
                [
                  "storage",
                  "ls",
                  ...(treeBrowse ? [] : ["--recursive"]),
                  "--json",
                  gcsPath,
                ],
                { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
              );
              return JSON.parse(stdout || "[]");
            } catch {
              // `gcloud storage ls --json` can be interrupted for very large
              // report trees, leaving a partial JSON array. Fall back to the
              // lightweight, documented gsutil output instead of parsing the
              // partial response and leaving the entire Reports page unusable.
              const { stdout: gsutilOutput } = await runGcloud(
                config,
                [
                  "storage",
                  "ls",
                  ...(treeBrowse ? [] : ["--recursive"]),
                  "--format=gsutil",
                  gcsPath,
                ],
                { timeout: 90_000, maxBuffer: 128 * 1024 * 1024 },
              );
              return Array.from(gsutilOutput.matchAll(/gs:\/\/[^\s]+/g)).map(
                ([url]) => ({ url: url.replace(/#\d+$/, "") }),
              );
            }
          }),
        );
        rows = listings.flat();
        gcsListCache.set(cacheKey, { createdAt: Date.now(), rows });
      }
    }
  } catch (error) {
    throw gcloudError(error);
  }
  const bucketPrefix = `gs://${config.gcsBucket}/`;
  const availableItems = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const metadata = row.metadata || row;
      const uriName = String(row.url || metadata.url || metadata.name || "");
      const name = uriName.startsWith(bucketPrefix)
        ? uriName.slice(bucketPrefix.length)
        : uriName;
      return {
        // gcloud appends #<generation> to URLs. It is metadata, not part of
        // the actual GCS object name, and breaks both display and downloads.
        name: name.replace(/#\d+$/, ""),
        size: String(metadata.size || "0"),
        timeCreated: metadata.timeCreated,
        updated:
          metadata.updated || metadata.updateTime || metadata.timeCreated,
        contentType:
          row.type === "prefix"
            ? "application/x-directory"
            : metadata.contentType || contentType(name),
        md5Hash: metadata.md5Hash,
        storageClass: metadata.storageClass || "STANDARD",
      };
    })
    .filter(
      (item) =>
        item.name &&
        roots.some((root) => item.name.startsWith(root)) &&
        (!requestedPrefix ||
          item.name.startsWith(requestedPrefix) ||
          roots.some((root) =>
            item.name.startsWith(`${root}/${requestedPrefix}`),
          )),
    );
  // Keep the folder list independent from the active date, type, and filename
  // filters. The UI can therefore search every folder without making the
  // folder selector appear to lose valid locations.
  const folderPrefixes = Array.from(
    new Set([
      ...apiFolderPrefixes,
      ...availableItems
        .map((item) => item.name.split("/").slice(0, -1).join("/"))
        .filter(Boolean),
    ]),
  ).sort();
  const items = availableItems
    .filter((item) => {
      if (query && !item.name.toLowerCase().includes(query)) return false;
      if (type === "logs" && !/\.(?:log|txt|out|err)$/i.test(item.name))
        return false;
      if (type === "archive" && !/\.(?:zip|gz|tar|tgz)$/i.test(item.name))
        return false;
      const date = String(item.updated || "").slice(0, 10);
      return (!from || date >= from) && (!to || date <= to);
    })
    .sort((a, b) =>
      String(b.updated || "").localeCompare(String(a.updated || "")),
    );
  const limit = Math.min(Math.max(Number(search.get("limit")) || 50, 1), 1000);
  return {
    project: config.gcsProject,
    bucket: config.gcsBucket,
    prefix: roots.join(", "),
    folderPrefixes,
    items: items.slice(0, limit),
    nextPageToken,
    authenticated: true,
    authMode: "local gcloud CLI",
    totalBytes: items
      .slice(0, limit)
      .reduce((sum, item) => sum + Number(item.size || 0), 0),
    allowDownload: true,
    scannedCount: useFastPagedListing ? rows.length : items.length,
    scanTruncated: Boolean(nextPageToken) || items.length > limit,
    initialFolderBrowse:
      useFastPagedListing && !requestedPrefix && !items.length,
  };
}
async function handleGcs(request, response, config) {
  const url = new URL(request.url, "http://localhost");
  const name = url.searchParams.get("name");
  if (!name)
    return send(response, 200, await listGcs(config, url.searchParams));
  const uri = gcsUri(config, name);
  if (url.searchParams.get("analyze") === "1") {
    if (!isTextObject(name))
      throw new Error(
        "Analysis is available for text, log, CSV, JSON, XML, YAML, and SQL reports.",
      );
    const maxBytes = 8 * 1024 * 1024;
    let stdout;
    try {
      ({ stdout } = await runGcloud(config, ["storage", "cat", uri], {
        timeout: 60_000,
        maxBuffer: maxBytes,
      }));
    } catch (error) {
      throw gcloudError(error);
    }
    return send(
      response,
      200,
      analyzeGcsReport(
        name,
        stdout.slice(0, maxBytes),
        Buffer.byteLength(stdout) >= maxBytes,
      ),
    );
  }
  if (
    url.searchParams.get("download") === "1" ||
    url.searchParams.get("view") === "1"
  ) {
    try {
      await runGcloud(config, ["storage", "ls", uri], { timeout: 15_000 });
    } catch (error) {
      throw gcloudError(error);
    }
    const csv = url.searchParams.get("csv") === "1";
    if (csv) {
      const { stdout } = await runGcloud(config, ["storage", "cat", uri], {
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const base = String(name)
        .split("/")
        .pop()
        .replace(/\.[^.]+$/, "");
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
        "Access-Control-Allow-Origin": "*",
      });
      response.end(toCsv(stdout, name));
      return;
    }
    const isInline = url.searchParams.get("view") === "1";
    response.writeHead(200, {
      "Content-Type": contentType(name),
      "Content-Disposition": `${isInline ? "inline" : "attachment"}; filename="${String(name).split("/").pop().replace(/\"/g, "")}"`,
      "Access-Control-Allow-Origin": "*",
    });
    const child = spawnGcloud(config, ["storage", "cat", uri]);
    child.stdout.pipe(response);
    child.stderr.resume();
    child.on("error", () => response.end());
    return;
  }
  if (!isTextObject(name))
    throw new Error(
      "Preview is available for text, log, CSV, JSON, XML, YAML, and SQL objects. Download this file to inspect it.",
    );
  let stdout;
  try {
    ({ stdout } = await runGcloud(config, ["storage", "cat", uri], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    }));
  } catch (error) {
    throw gcloudError(error);
  }
  const truncated = Buffer.byteLength(stdout) >= 2 * 1024 * 1024;
  return send(response, 200, {
    content: stdout.slice(0, 2 * 1024 * 1024),
    truncated,
  });
}
function send(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  });
  response.end(JSON.stringify(payload));
}
http
  .createServer(async (request, response) => {
    if (request.method === "OPTIONS") return send(response, 204, {});
    let raw = "";
    for await (const chunk of request) raw += chunk;
    if (request.method === "GET" && request.url === "/")
      return send(response, 200, {
        ok: true,
        message: "Local BES connector is running.",
        configUrl: "/local-bes/config",
      });
    const requestUrl = new URL(
      request.url,
      `http://${request.headers.host || "localhost"}`,
    );
    const environment = validEnvironment(
      requestUrl.searchParams.get("environment") || "LOCAL",
    );
    if (
      request.method === "GET" &&
      requestUrl.pathname === "/local-bes/config"
    ) {
      const all = await readAllConfigs();
      return send(response, 200, {
        environment,
        profiles: Object.keys(all.profiles || {}).sort(),
        config: publicConfig(await readConfig(environment)),
        connectionHealth: localConnectionHealth(await readConfig(environment)),
      });
    }
    if (request.method === "GET" && request.url.startsWith("/local-bes/gcs")) {
      try {
        return await handleGcs(
          request,
          response,
          await readConfig(environment),
        );
      } catch (error) {
        return send(response, 400, {
          ok: false,
          code: "GCS_AUTH_REQUIRED",
          error:
            error instanceof Error
              ? error.message
              : "Unable to read the configured GCS bucket.",
        });
      }
    }
    if (
      request.method === "GET" &&
      requestUrl.pathname === "/local-bes/rmj/jobs"
    ) {
      try {
        return await handleRmjJobs(
          request,
          response,
          await readConfig(environment),
        );
      } catch (error) {
        return send(response, 400, {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to read RunMyJobs jobs.",
        });
      }
    }
    if (
      request.method === "POST" &&
      requestUrl.pathname === "/local-bes/logs"
    ) {
      try {
        const input = JSON.parse(raw || "{}");
        return await handleCloudLogs(
          response,
          await readConfig(validEnvironment(input.environment || environment)),
          validEnvironment(input.environment || environment),
          input,
        );
      } catch (error) {
        return send(response, 400, {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to read Cloud Logging entries.",
        });
      }
    }
    if (
      request.method === "PUT" &&
      requestUrl.pathname === "/local-bes/config"
    ) {
      try {
        const all = await readAllConfigs();
        const body = JSON.parse(raw || "{}");
        const selectedEnvironment = validEnvironment(
          body.environment || environment,
        );
        const previous = await readConfig(selectedEnvironment);
        const incoming = body.config || {};
        const next = {
          ...previous,
          ...Object.fromEntries(
            Object.entries(incoming).filter(
              ([key, value]) =>
                key in defaults &&
                typeof value === "string" &&
                (value || key !== "oraclePassword"),
            ),
          ),
        };
        all.profiles = { ...(all.profiles || {}), [selectedEnvironment]: next };
        await writeFile(configFile, JSON.stringify(all, null, 2), {
          mode: 0o600,
        });
        return send(response, 200, {
          environment: selectedEnvironment,
          profiles: Object.keys(all.profiles || {}).sort(),
          config: publicConfig(next),
          message: `${selectedEnvironment} settings saved.`,
        });
      } catch {
        return send(response, 400, {
          ok: false,
          message: "Local settings could not be saved.",
        });
      }
    }
    if (
      request.method === "POST" &&
      requestUrl.pathname === "/local-bes/test"
    ) {
      try {
        const { target, environment: bodyEnvironment } = JSON.parse(
          raw || "{}",
        );
        const config = await readConfig(
          validEnvironment(bodyEnvironment || environment),
        );
        let message = "";
        if (target === "rmj") {
          if (!config.rmjJobsUrl)
            throw new Error("Enter the RunMyJobs jobs URL, then save.");
          const response = await fetch(config.rmjJobsUrl, {
            headers: {
              Accept: "application/json",
              ...(config.rmjToken
                ? { Authorization: `Bearer ${config.rmjToken}` }
                : {}),
            },
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok)
            throw new Error(`RunMyJobs returned HTTP ${response.status}.`);
          message = "RunMyJobs accepted the configured jobs endpoint.";
        } else if (target === "logs") {
          const container = String(config.logContainers)
            .split(",")
            .map((x) => x.trim())
            .find(Boolean);
          if (!container) throw new Error("Add at least one container name.");
          await exec(
            config.podmanCommand || "podman",
            ["logs", "--tail", "1", container],
            { timeout: 10_000 },
          );
          message = `Read recent logs from ${container}.`;
        } else if (target === "oracle") {
          if (
            !config.oracleConnectString ||
            !config.oracleUser ||
            !config.oraclePassword
          )
            throw new Error(
              "Enter Oracle connect string, user, and password, then save.",
            );
          const connect = String(config.oracleConnectString).replace(
            /^jdbc:oracle:thin:@\/\//,
            "",
          );
          const { stdout } = config.oracleClientCommand
            ? await runWithInput(
                config.oracleClientCommand,
                [
                  "-s",
                  `${config.oracleUser}/${config.oraclePassword}@${connect}`,
                ],
                "SELECT 1 FROM DUAL;\nEXIT;\n",
                15_000,
              )
            : await exec(
                config.podmanCommand || "podman",
                [
                  "exec",
                  "-e",
                  `ORACLE_USER=${config.oracleUser}`,
                  "-e",
                  `ORACLE_PASSWORD=${config.oraclePassword}`,
                  "-e",
                  `ORACLE_CONNECT=${connect}`,
                  "oracledb",
                  "bash",
                  "-lc",
                  "printf 'SELECT 1 FROM DUAL;\\nEXIT;\\n' | sqlplus -s \"$ORACLE_USER/$ORACLE_PASSWORD@$ORACLE_CONNECT\"",
                ],
                { timeout: 15_000 },
              );
          if (!/1/.test(stdout))
            throw new Error("Oracle did not return SELECT 1 FROM DUAL.");
          message =
            "Oracle completed SELECT 1 FROM DUAL through the local container.";
        } else if (target === "mongo") {
          if (!config.mongoUrl)
            throw new Error("Enter the MongoDB URL, then save.");
          new URL(config.mongoUrl);
          const { stdout } = config.mongoClientCommand
            ? await exec(
                config.mongoClientCommand,
                [
                  config.mongoUrl,
                  "--quiet",
                  "--eval",
                  "JSON.stringify(db.runCommand({ping:1}))",
                ],
                { timeout: 15_000 },
              )
            : await exec(
                config.podmanCommand || "podman",
                [
                  "exec",
                  "mongodb",
                  "mongosh",
                  config.mongoUrl,
                  "--quiet",
                  "--eval",
                  "JSON.stringify(db.runCommand({ping:1}))",
                ],
                { timeout: 15_000 },
              );
          if (!/"ok"\s*:\s*1/.test(stdout))
            throw new Error("MongoDB did not return a successful ping.");
          message =
            "MongoDB completed a real ping through the local container.";
        } else if (target === "gcs") {
          const uri = gcsUri(config);
          try {
            await runGcloud(config, ["storage", "ls", uri], {
              timeout: 30_000,
              maxBuffer: 1024 * 1024,
            });
          } catch (error) {
            throw gcloudError(error);
          }
          message = `Google Cloud CLI confirmed read access to ${uri}.`;
        } else if (target === "cloud-logs") {
          if (!String(config.gcsProject || "").trim())
            throw new Error("Enter the Google Cloud project, then save.");
          try {
            await runGcloud(
              config,
              ["logging", "read", "--format=json", "--limit", "1"],
              { timeout: 30_000, maxBuffer: 1024 * 1024 },
            );
          } catch (error) {
            throw gcloudError(error);
          }
          message = `Google Cloud CLI confirmed Log Explorer read access to ${config.gcsProject}.`;
        } else if (target === "cloud-logs-analytics") {
          if (!String(config.logAnalyticsEndpoint || "").trim())
            throw new Error(
              "No exact-count analytics endpoint has been provided yet. Google Cloud log viewing remains available.",
            );
          const analyticsResponse = await fetch(config.logAnalyticsEndpoint, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              ...(config.logAnalyticsToken
                ? { Authorization: `Bearer ${config.logAnalyticsToken}` }
                : {}),
            },
            body: JSON.stringify({ healthCheck: true }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!analyticsResponse.ok)
            throw new Error(
              `Exact log analytics returned HTTP ${analyticsResponse.status}.`,
            );
          message =
            "Exact log analytics endpoint accepted the connection test.";
        } else throw new Error("Unknown local connector.");
        return send(response, 200, { ok: true, message });
      } catch (error) {
        return send(response, 400, {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Local connector test failed.",
        });
      }
    }
    if (
      request.method === "POST" &&
      requestUrl.pathname === "/local-bes/validation"
    ) {
      try {
        const {
          query,
          phase,
          jobName,
          businessDate,
          environment: bodyEnvironment,
          queryType = "SQL",
        } = JSON.parse(raw || "{}");
        if (
          (phase !== "PRE" && phase !== "POST") ||
          typeof jobName !== "string"
        )
          throw new Error("A job name and PRE or POST phase are required.");
        const config = await readConfig(
          validEnvironment(bodyEnvironment || environment),
        );
        const result =
          queryType === "MONGO"
            ? await executeMongoValidation(config, query)
            : await executeOracleValidation(config, query, businessDate);
        return send(response, 200, {
          ok: true,
          status: "SUCCESS",
          message: `${phase} validation completed locally for ${jobName}.${result.rowCount == null ? "" : ` ${result.rowCount} rows selected.`}`,
          resultCount: result.rowCount,
          preview: result.preview,
        });
      } catch (error) {
        return send(response, 400, {
          ok: false,
          status: "FAILED",
          message:
            error instanceof Error ? error.message : "Local validation failed.",
        });
      }
    }
    if (request.method !== "POST" || request.url !== "/local-bes/execute")
      return send(response, 404, { ok: false, message: "Route not found." });
    try {
      const { action, username, password, jobId, jobName, jobParams } =
        JSON.parse(raw || "{}");
      const target = actions[action];
      if (!target)
        return send(response, 400, {
          ok: false,
          message: "Choose a valid local BES action.",
        });
      const sessionCookie = await createBesSession(username, password);
      const url = new URL(target.url);
      if (action === "status") {
        if (typeof jobId !== "string" || !jobId.trim())
          return send(response, 400, {
            ok: false,
            message: "Enter the FMM job ID to check its status.",
          });
        url.searchParams.set("jobId", jobId.trim());
      } else {
        if (typeof jobName !== "string" || !jobName.trim())
          return send(response, 400, {
            ok: false,
            message: "Enter the batch job name to start it.",
          });
        if (typeof jobParams !== "string" || !jobParams.trim())
          return send(response, 400, {
            ok: false,
            message:
              "Enter the job parameters, for example runDate=YYYY-MM-DD,v=2.",
          });
        url.searchParams.set("jobName", jobName.trim());
        url.searchParams.set("jobParams", jobParams.trim());
      }
      const upstream = await fetch(url, {
        method: target.method,
        headers: { Cookie: sessionCookie, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      const body = await upstream.text();
      const detail = body.replace(/\s+/g, " ").slice(0, 400);
      return send(response, upstream.ok ? 200 : upstream.status, {
        ok: upstream.ok,
        status: upstream.status,
        message: `${target.label} returned HTTP ${upstream.status}.${detail ? ` ${detail}` : ""}`,
      });
    } catch (error) {
      return send(response, 502, {
        ok: false,
        message:
          error instanceof Error
            ? `Local BES request failed while contacting the local batch service: ${error.message}${error.cause instanceof Error && error.cause.message ? ` (${error.cause.message})` : ""}`
            : "Local BES request failed.",
      });
    }
  })
  .listen(PORT, "127.0.0.1", () =>
    console.log(`Local BES connector listening on http://localhost:${PORT}`),
  );
