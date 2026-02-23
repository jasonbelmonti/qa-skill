export type ArtifactSchemaVersion =
  | "skill-input.v1"
  | "lens-plan.v1"
  | "lens-result.v1"
  | "final-verdict.v1"
  | "skill-result.v1"
  | "execution-audit.v1";

export type RunMode = "strict" | "best_effort";
export type VerdictStatus = "PASS" | "FAIL";

export type LensClass =
  | "consistency"
  | "security"
  | "architecture"
  | "style"
  | "performance";

export type LensStatus = "completed" | "degraded" | "failed" | "skipped";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type PermissionProfileId =
  | "read_only"
  | "exec_sandboxed"
  | "exec_sandboxed_network_off";

export type BlockingPolicy = "rule_defined" | "severity_threshold" | "mixed";
export type OverflowPolicy = "stop" | "skip" | "escalate";
export type ExecutionCwdMode = "repo_root" | "ephemeral_worktree";

export type UsageUnavailableReason =
  | "PROVIDER_NOT_SUPPORTED"
  | "MISSING_USAGE_DATA"
  | "ADAPTER_ERROR";

export type ErrorCode =
  | "BASE_REF_CONFIGURED_NOT_FOUND"
  | "BASE_REF_FALLBACK_ORIGIN_HEAD_UNAVAILABLE"
  | "BASE_REF_FALLBACK_ORIGIN_MAIN"
  | "BASE_REF_FALLBACK_ORIGIN_MASTER"
  | "BASE_REF_RESOLUTION_FAILED"
  | "DIFF_TOO_LARGE"
  | "CONTEXT_BOUND_EXCEEDED"
  | "PLAN_CONFIDENCE_LOW_BROAD_SCAN"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_AUTH_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_USAGE_UNAVAILABLE"
  | "EXECUTION_DENIED"
  | "EXECUTION_POLICY_VIOLATION"
  | "EXECUTION_TIMEOUT"
  | "EXECUTION_EXIT_NONZERO"
  | "EXECUTION_AUDIT_UNAVAILABLE"
  | "LENS_REQUIRED_MISSING"
  | "LENS_REQUIRED_FAILED"
  | "BUDGET_RUN_EXCEEDED"
  | "BUDGET_LENS_EXCEEDED"
  | "ARTIFACT_SCHEMA_INVALID"
  | "DETERMINISM_DRIFT_DETECTED";

export interface UsageMetrics {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  unavailableReason: UsageUnavailableReason | null;
}
