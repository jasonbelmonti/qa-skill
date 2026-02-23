import type {
  ArtifactSchemaVersion,
  LensClass,
  PermissionProfileId,
  RunMode,
} from "./common";

export type SkillSchemaVersion =
  | ArtifactSchemaVersion
  | "skill-manifest.v1"
  | "skill-registry.v1";
export type SchemaVersion = SkillSchemaVersion;

export type {
  ArtifactSchemaVersion,
  BlockingPolicy,
  ErrorCode,
  ExecutionCwdMode,
  LensClass,
  LensStatus,
  OverflowPolicy,
  PermissionProfileId,
  RunMode,
  Severity,
  UsageMetrics,
  UsageUnavailableReason,
  VerdictStatus,
} from "./common";

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
  schemaVersion: "skill-input.v1";
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
