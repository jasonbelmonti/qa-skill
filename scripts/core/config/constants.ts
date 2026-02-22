import type { LensClass, PermissionProfileId, RunMode } from "../../contracts/skill-input";

export const LENS_CLASSES: readonly LensClass[] = [
  "consistency",
  "security",
  "architecture",
  "style",
  "performance",
];

export const PERMISSION_PROFILE_IDS: readonly PermissionProfileId[] = [
  "read_only",
  "exec_sandboxed",
  "exec_sandboxed_network_off",
];

export const RUN_MODES: readonly RunMode[] = ["strict", "best_effort"];

export const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "repoId",
  "repoRoot",
  "baseRef",
  "headRef",
  "runMode",
  "requestedLensIds",
  "maxConcurrency",
  "allowExecutionLensClasses",
  "permissionProfiles",
  "defaultPermissionProfileId",
  "artifactRoot",
  "runBudgetMaxTokens",
  "runBudgetMaxCostUsd",
  "providerBindings",
]);
