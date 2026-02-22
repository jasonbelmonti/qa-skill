export type SchemaVersion = "skill-input.v1";

export type RunMode = "strict" | "best_effort";
export type LensClass =
  | "consistency"
  | "security"
  | "architecture"
  | "style"
  | "performance";
export type PermissionProfileId =
  | "read_only"
  | "exec_sandboxed"
  | "exec_sandboxed_network_off";

export interface ProviderBinding {
  bindingId: string;
  adapterId: "openai-codex" | "anthropic-claude";
  adapterVersion: string;
  modelId: string;
  temperature: 0;
  topP: 1;
  maxTokens: number;
  seed: number | null;
  timeoutMs: number;
  retryMax: 2;
  retryBackoffMs: readonly [500, 1500];
}

export interface PermissionProfile {
  profileId: PermissionProfileId;
  readOnly: boolean;
  allowNetwork: boolean;
  worktreeMode: "none" | "ephemeral";
  allowedCommandPrefixes: string[][];
  maxCommandsPerPlan: number;
  commandTimeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

export interface SkillInput {
  schemaVersion: SchemaVersion;
  repoId: string;
  repoRoot: string;
  vcs: "git";
  baseRef: string | null;
  headRef: string;
  runMode: RunMode;
  requestedLensIds: string[] | null;
  maxConcurrency: number;
  allowExecutionLensClasses: LensClass[];
  permissionProfiles: PermissionProfile[];
  defaultPermissionProfileId: PermissionProfileId;
  artifactRoot: string;
  runBudgetMaxTokens: number;
  runBudgetMaxCostUsd: number | null;
  providerBindings: ProviderBinding[];
  configHash: string;
}
