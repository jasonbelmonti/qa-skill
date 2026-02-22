import type {
  PermissionProfile,
  PermissionProfileId,
  RunMode,
} from "../../contracts/skill-input";

export const DEFAULT_READ_ONLY_PERMISSION_PROFILE: PermissionProfile = {
  profileId: "read_only",
  readOnly: true,
  allowNetwork: false,
  worktreeMode: "none",
  allowedCommandPrefixes: [],
  maxCommandsPerPlan: 0,
  commandTimeoutMs: 0,
  maxStdoutBytes: 0,
  maxStderrBytes: 0,
};

export const DEFAULT_PERMISSION_PROFILE_ID: PermissionProfileId = "read_only";
export const DEFAULT_VCS = "git" as const;
export const DEFAULT_BASE_REF = null;
export const DEFAULT_HEAD_REF = "HEAD";
export const DEFAULT_RUN_MODE: RunMode = "strict";
export const DEFAULT_REQUESTED_LENS_IDS: string[] | null = null;
export const DEFAULT_MAX_CONCURRENCY = 4;
export const DEFAULT_ARTIFACT_ROOT = ".qa-skill";
export const DEFAULT_RUN_BUDGET_MAX_TOKENS = 300_000;
export const DEFAULT_RUN_BUDGET_MAX_COST_USD = 12;
