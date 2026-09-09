export const ENVIRONMENTS = [
  { id: "LOCAL", label: "Local BES", tier: "Local" },
  { id: "DEV1", label: "DEV1", tier: "Non-prod" },
  { id: "DEV2", label: "DEV2", tier: "Non-prod" },
  { id: "HAN1", label: "HAN1", tier: "Non-prod" },
  { id: "INT1", label: "INT1", tier: "Non-prod" },
  { id: "SIT1", label: "SIT1", tier: "Non-prod" },
  { id: "TIM1", label: "TIM1", tier: "Non-prod" },
  { id: "NP_PER1", label: "PER1", tier: "Non-prod" },
  { id: "TRN1", label: "TRN1", tier: "Non-prod" },
  { id: "TRN2", label: "TRN2", tier: "Non-prod" },
  { id: "UAT1", label: "UAT1", tier: "Prod" },
  { id: "PROD_TIM3", label: "TIM3", tier: "Prod" },
  { id: "PER1", label: "PER1", tier: "Prod" },
  { id: "STG1", label: "STG1", tier: "Prod" },
] as const;

export type EnvironmentId = (typeof ENVIRONMENTS)[number]["id"];
