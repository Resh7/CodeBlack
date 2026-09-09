import {
  APPROVED_MICROSERVICES,
  APPROVED_NAMESPACES,
  getEnvironmentIntegration,
} from "@/lib/integrations";

export async function GET(request: Request) {
  try {
    const environment =
      new URL(request.url).searchParams.get("environment")?.trim() || "LOCAL";
    const connection = await getEnvironmentIntegration(
      "GCP_LOGGING",
      environment,
    );
    const projectId = String(connection?.nonSecretConfig.projectId || "bes-np");
    const approvedNamespaces =
      APPROVED_NAMESPACES[projectId as keyof typeof APPROVED_NAMESPACES] ?? [];
    const configuredNamespaces = String(
      connection?.nonSecretConfig.namespaces || "",
    )
      .split(",")
      .map((item) => item.trim())
      .filter((item) =>
        (approvedNamespaces as readonly string[]).includes(item),
      );
    const configuredServices = String(
      connection?.nonSecretConfig.microservices || "",
    )
      .split(",")
      .map((item) => item.trim())
      .filter((item) =>
        (APPROVED_MICROSERVICES as readonly string[]).includes(item),
      );
    return Response.json({
      projects: [
        {
          id: projectId,
          namespaces: configuredNamespaces.length
            ? configuredNamespaces
            : approvedNamespaces,
        },
      ],
      microservices: configuredServices.length
        ? configuredServices
        : APPROVED_MICROSERVICES,
      resourceType: connection?.nonSecretConfig.resourceType ?? "k8s_container",
      retentionDays: connection?.nonSecretConfig.retentionDays || null,
      connectorStatus: connection?.status ?? "NOT_CONFIGURED",
      lastTestedAt: connection?.lastTestedAt ?? null,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Cloud Logging options.",
      },
      { status: 500 },
    );
  }
}
