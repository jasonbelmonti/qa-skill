import type {
  LensClass,
  PermissionProfile,
  PermissionProfileId,
  ProviderBinding,
  RunMode,
} from "./skill-input";

export interface QaRunConfigV1 {
  schemaVersion?: "qa-run-config.v1";
  repoId?: string;
  repoRoot?: string;
  baseRef?: string | null;
  headRef?: string;
  runMode?: RunMode;
  requestedLensIds?: string[] | null;
  includeGlobs?: string[] | null;
  excludeGlobs?: string[] | null;
  explicitFiles?: string[] | null;
  maxConcurrency?: number;
  allowExecutionLensClasses?: LensClass[];
  permissionProfiles?: PermissionProfile[];
  defaultPermissionProfileId?: PermissionProfileId;
  artifactRoot?: string;
  runBudgetMaxTokens?: number;
  runBudgetMaxCostUsd?: number | null;
  providerBindings?: ProviderBinding[];
}
