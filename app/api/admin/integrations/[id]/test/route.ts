import {
  getIntegration,
  persistTestResult,
  recordIntegrationAudit,
  testIntegration,
} from "@/lib/integrations";

function currentUser(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "Authenticated integration administrator";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const actorId = currentUser(request);
  try {
    const connection = await getIntegration(id);
    if (!connection) return Response.json({ error: "Unknown integration connector." }, { status: 404 });
    const result = await testIntegration(connection);
    await persistTestResult(connection, result, actorId);
    return Response.json({ result }, { status: result.status === "FAILED" ? 424 : 200 });
  } catch (error) {
    const correlationId = `health_${crypto.randomUUID()}`;
    await recordIntegrationAudit({
      eventType: "CONNECTION_TESTED",
      actorId,
      environment: "UNKNOWN",
      integration: id,
      targetId: id,
      result: "FAILED",
      correlationId,
      detail: { category: "UPSTREAM" },
    }).catch(() => undefined);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Connection test failed.",
        category: "UPSTREAM",
        correlationId,
      },
      { status: 500 },
    );
  }
}
