import {
  loadIntegrationState,
  saveIntegration,
  validateIntegrationUpdate,
} from "@/lib/integrations";

function currentUser(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "Authenticated integration administrator";
}

export async function GET() {
  try {
    const state = await loadIntegrationState();
    return Response.json({
      integrations: state.integrations,
      storageAvailable: state.storageAvailable,
      storageWarning: state.storageWarning,
      policy: {
        releaseMode: "READ_ONLY",
        productionRequiresApproval: true,
        secretsReturnedToBrowser: false,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load integrations." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json() as { id?: string; connection?: unknown };
    if (!payload.id) return Response.json({ error: "Integration ID is required." }, { status: 400 });
    const connection = validateIntegrationUpdate(payload.id, payload.connection);
    const saved = await saveIntegration(connection, currentUser(request));
    return Response.json({ integration: saved });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save the integration." },
      { status: 400 },
    );
  }
}
