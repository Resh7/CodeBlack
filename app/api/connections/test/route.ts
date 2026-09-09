type TestRequest = {
  type?: "rmj" | "gcs" | "gateway";
  url?: string;
  bucket?: string;
};

function safeExternalUrl(value: string, type: TestRequest["type"]) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Only HTTPS endpoints are allowed.");
  const host = url.hostname.toLowerCase();
  if (type === "rmj" && !host.endsWith(".runmyjobs.cloud")) {
    throw new Error("The RMJ endpoint must use runmyjobs.cloud.");
  }
  if (type === "gcs" && host !== "storage.googleapis.com") {
    throw new Error("The GCS test must use the Google Cloud Storage API.");
  }
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(host) || host.endsWith(".local")) {
    throw new Error("Private or local endpoints are not allowed from the hosted tester.");
  }
  return url;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as TestRequest;
    if (!payload.type) return Response.json({ error: "Connection type is required." }, { status: 400 });

    const target =
      payload.type === "gcs"
        ? `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(payload.bucket?.trim() ?? "")}`
        : payload.url?.trim() ?? "";
    if (!target || (payload.type === "gcs" && !payload.bucket?.trim())) {
      return Response.json({ error: "A connection endpoint is required." }, { status: 400 });
    }
    const url = safeExternalUrl(target, payload.type);
    const startedAt = Date.now();
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/json,text/html;q=0.8" },
      signal: AbortSignal.timeout(10_000),
    });
    const durationMs = Date.now() - startedAt;
    const authenticated = response.status >= 200 && response.status < 300;
    const reachable = response.status < 500;
    const authenticationRequired = [301, 302, 303, 307, 308, 401, 403].includes(response.status);

    return Response.json({
      reachable,
      authenticated,
      authenticationRequired,
      status: response.status,
      durationMs,
      message: authenticated
        ? "Connection succeeded and the endpoint accepted this request."
        : authenticationRequired
          ? "The endpoint is reachable, but approved API authentication is still required."
          : reachable
            ? `The endpoint responded with HTTP ${response.status}. Review the configured API path.`
            : "The endpoint could not be reached.",
    });
  } catch (error) {
    return Response.json(
      { reachable: false, authenticated: false, error: error instanceof Error ? error.message : "Connection test failed." },
      { status: 400 },
    );
  }
}
