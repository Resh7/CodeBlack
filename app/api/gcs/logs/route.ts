import {
  getEnvironmentIntegration,
  getGcpAccessToken,
  recordIntegrationAudit,
} from "@/lib/integrations";

type GcsObject = {
  name: string;
  size?: string;
  timeCreated?: string;
  updated?: string;
  contentType?: string;
  md5Hash?: string;
  storageClass?: string;
};

type GcsResult = {
  items?: GcsObject[];
  nextPageToken?: string;
  error?: { message?: string };
};

const LOG_EXTENSIONS = [".log", ".txt", ".json", ".jsonl", ".out", ".csv"];
const ARCHIVE_EXTENSIONS = [".gz", ".zip"];

function currentUser(request: Request) {
  return (
    request.headers.get("oai-authenticated-user-email") ??
    "Authenticated operator"
  );
}

function configuredList(value: unknown) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().replace(/^\/+/, ""))
    .filter(Boolean);
}

function isAllowedObject(
  name: string,
  basePath: string,
  approvedPrefixes: string[],
) {
  const withinBase = !basePath || name.startsWith(basePath);
  return (
    withinBase && approvedPrefixes.some((prefix) => name.startsWith(prefix))
  );
}

function isCompatiblePrefix(
  prefix: string,
  basePath: string,
  approvedPrefixes: string[],
) {
  if (basePath && !prefix.startsWith(basePath) && !basePath.startsWith(prefix))
    return false;
  return (
    !prefix ||
    approvedPrefixes.some(
      (allowed) => allowed.startsWith(prefix) || prefix.startsWith(allowed),
    )
  );
}

function safeDownloadName(name: string) {
  return (name.split("/").pop() || "gcs-object.txt").replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );
}

function parseDate(value: string | null, endOfDay = false) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Date filters must use YYYY-MM-DD.");
  const time = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}Z`,
  ).getTime();
  if (!Number.isFinite(time)) throw new Error("A GCS date filter is invalid.");
  return time;
}

function gcsFailure(status: number, message?: string) {
  const authRequired = status === 401 || status === 403;
  return Response.json(
    {
      code: authRequired ? "GCS_AUTH_REQUIRED" : "GCS_REQUEST_FAILED",
      authenticated: false,
      error: authRequired
        ? "The GCS bucket is reachable, but the configured identity is not authorized for this request."
        : message || `Google Cloud Storage returned HTTP ${status}.`,
    },
    { status: authRequired ? 401 : 502 },
  );
}

async function listPage(
  bucket: string,
  token: string,
  prefix: string,
  pageToken: string | null,
  maxResults: number,
) {
  const listUrl = new URL(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`,
  );
  listUrl.searchParams.set("maxResults", String(maxResults));
  listUrl.searchParams.set(
    "fields",
    "items(name,size,timeCreated,updated,contentType,md5Hash,storageClass),nextPageToken",
  );
  if (prefix) listUrl.searchParams.set("prefix", prefix);
  if (pageToken) listUrl.searchParams.set("pageToken", pageToken);
  const response = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json().catch(() => ({}))) as GcsResult;
  return { response, result };
}

export async function GET(request: Request) {
  const correlationId = `gcs_${crypto.randomUUID()}`;
  const started = Date.now();
  try {
    const url = new URL(request.url);
    const environment = url.searchParams.get("environment")?.trim() || "LOCAL";
    const connection = await getEnvironmentIntegration(
      "GCP_STORAGE",
      environment,
    );
    if (!connection || !connection.enabled) {
      return Response.json(
        {
          code: "GCS_NOT_CONFIGURED",
          error: "Google Cloud Storage is disabled in Settings.",
          correlationId,
        },
        { status: 409 },
      );
    }
    const bucket = String(connection.nonSecretConfig.bucket || "").trim();
    const basePath = String(connection.nonSecretConfig.basePath || "")
      .trim()
      .replace(/^\/+/, "");
    const approvedPrefixes = configuredList(
      connection.nonSecretConfig.approvedPrefixes,
    );
    const allowDownload = Boolean(connection.nonSecretConfig.allowDownload);
    if (!bucket || !approvedPrefixes.length) {
      return Response.json(
        {
          code: "GCS_NOT_CONFIGURED",
          error: "Configure the GCS bucket and approved prefixes in Settings.",
          correlationId,
        },
        { status: 409 },
      );
    }
    let token: string;
    try {
      token = await getGcpAccessToken(connection);
    } catch (error) {
      return Response.json(
        {
          code: "GCS_AUTH_REQUIRED",
          authenticated: false,
          error:
            error instanceof Error
              ? error.message
              : "The GCP runtime identity is not configured.",
          correlationId,
        },
        { status: 401 },
      );
    }

    const objectName = url.searchParams.get("name")?.trim().replace(/^\/+/, "");
    if (objectName) {
      if (!isAllowedObject(objectName, basePath, approvedPrefixes)) {
        return Response.json(
          {
            error:
              "The requested object is outside the configured GCS allowlist.",
            correlationId,
          },
          { status: 403 },
        );
      }
      const download = url.searchParams.get("download") === "1";
      if (download && !allowDownload) {
        return Response.json(
          {
            error: "Downloads are disabled for this GCS connector.",
            correlationId,
          },
          { status: 403 },
        );
      }
      const mediaUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
      const previewBytes = Math.round(
        Math.min(
          Math.max(Number(connection.nonSecretConfig.maxPreviewMb || 2), 0.1),
          10,
        ) *
          1024 *
          1024,
      );
      const response = await fetch(mediaUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/plain,application/json,text/csv,*/*;q=0.5",
          ...(download ? {} : { Range: `bytes=0-${previewBytes - 1}` }),
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok && response.status !== 206) {
        const detail = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        return gcsFailure(response.status, detail.error?.message);
      }
      const eventType = download
        ? "GCS_OBJECT_DOWNLOADED"
        : "GCS_OBJECT_PREVIEWED";
      await recordIntegrationAudit({
        eventType,
        actorId: currentUser(request),
        environment: connection.environment,
        integration: connection.type,
        targetId: objectName,
        result: "SUCCEEDED",
        durationMs: Date.now() - started,
        correlationId,
        detail: { bucket },
      }).catch(() => undefined);
      if (download) {
        return new Response(response.body, {
          headers: {
            "Content-Type":
              response.headers.get("content-type") ||
              "application/octet-stream",
            "Content-Disposition": `attachment; filename="${safeDownloadName(objectName)}"`,
            "Cache-Control": "private, no-store",
            "X-Correlation-Id": correlationId,
          },
        });
      }
      const content = await response.text();
      return Response.json({
        name: objectName,
        content,
        contentType: response.headers.get("content-type") || "text/plain",
        truncated:
          response.status === 206 ||
          Boolean(response.headers.get("content-range")),
        authenticated: true,
        authMode: "runtime identity",
        allowDownload,
        correlationId,
      });
    }

    const prefixInput =
      url.searchParams.get("prefix")?.trim().replace(/^\/+/, "") ?? "";
    const prefix =
      basePath && !prefixInput.startsWith(basePath)
        ? `${basePath.replace(/\/?$/, "/")}${prefixInput}`
        : prefixInput || basePath;
    if (!isCompatiblePrefix(prefix, basePath, approvedPrefixes)) {
      return Response.json(
        {
          error:
            "The requested prefix is outside the configured GCS allowlist.",
          correlationId,
        },
        { status: 403 },
      );
    }
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit")) || 50, 10),
      100,
    );
    const search = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const kind = url.searchParams.get("type") ?? "all";
    if (!["all", "logs", "archives"].includes(kind))
      return Response.json(
        { error: "Unsupported GCS file type filter.", correlationId },
        { status: 400 },
      );
    const from = parseDate(url.searchParams.get("from"));
    const to = parseDate(url.searchParams.get("to"), true);
    if (from != null && to != null && from > to)
      return Response.json(
        {
          error: "The GCS start date must not be after the end date.",
          correlationId,
        },
        { status: 400 },
      );
    const filterActive = Boolean(
      search || from != null || to != null || kind !== "all" || !prefix,
    );
    const maxScanCount = Math.min(
      Math.max(Number(connection.nonSecretConfig.maxScanCount || 1000), 10),
      5000,
    );
    const requestedPageToken = filterActive
      ? null
      : url.searchParams.get("pageToken")?.trim() || null;
    const matches: GcsObject[] = [];
    let scannedCount = 0;
    let nextToken: string | null = requestedPageToken;
    let remaining = filterActive ? maxScanCount : limit;
    do {
      const pageSize = Math.min(filterActive ? 1000 : limit, remaining);
      const { response, result } = await listPage(
        bucket,
        token,
        prefix,
        nextToken,
        pageSize,
      );
      if (!response.ok)
        return gcsFailure(response.status, result.error?.message);
      const items = result.items ?? [];
      scannedCount += items.length;
      remaining -= items.length;
      for (const item of items) {
        if (!isAllowedObject(item.name, basePath, approvedPrefixes)) continue;
        const lowerName = item.name.toLowerCase();
        const updated = item.updated ? new Date(item.updated).getTime() : null;
        if (search && !lowerName.includes(search)) continue;
        if (
          kind === "logs" &&
          !LOG_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
        )
          continue;
        if (
          kind === "archives" &&
          !ARCHIVE_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
        )
          continue;
        if (from != null && (updated == null || updated < from)) continue;
        if (to != null && (updated == null || updated > to)) continue;
        matches.push(item);
      }
      nextToken = result.nextPageToken ?? null;
      if (!filterActive) break;
    } while (nextToken && remaining > 0 && matches.length < limit);

    const items = matches
      .sort((left, right) =>
        (right.updated || "").localeCompare(left.updated || ""),
      )
      .slice(0, limit);
    const scanTruncated =
      filterActive &&
      Boolean(nextToken) &&
      (remaining <= 0 || matches.length >= limit);
    await recordIntegrationAudit({
      eventType: "GCS_OBJECTS_LISTED",
      actorId: currentUser(request),
      environment: connection.environment,
      integration: connection.type,
      targetId: bucket,
      result: "SUCCEEDED",
      durationMs: Date.now() - started,
      rowCount: items.length,
      correlationId,
      detail: { prefix, scannedCount, filtered: filterActive },
    }).catch(() => undefined);
    return Response.json({
      bucket,
      prefix,
      items,
      nextPageToken: filterActive ? null : nextToken,
      authenticated: true,
      authMode: "runtime identity",
      allowDownload,
      totalBytes: items.reduce(
        (total, item) => total + Number(item.size || 0),
        0,
      ),
      scannedCount,
      scanTruncated,
      correlationId,
    });
  } catch (error) {
    return Response.json(
      {
        code: "GCS_LOGS_ERROR",
        authenticated: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load GCS objects.",
        correlationId,
      },
      { status: 500 },
    );
  }
}
