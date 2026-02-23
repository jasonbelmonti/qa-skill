import type {
  BlockingPolicy,
  ErrorCode,
  ExecutionCwdMode,
  LensClass,
  LensStatus,
  OverflowPolicy,
  PermissionProfileId,
  Severity,
  UsageMetrics,
  VerdictStatus,
} from "./common";

export interface ExecutionCommandSpec {
  ordinal: number;
  command: string[];
  cwdMode: ExecutionCwdMode;
  purpose: string;
}

export interface ExecutionCommandResult {
  ordinal: number;
  exitCode: number | null;
  timedOut: boolean;
  stdoutSha256: string;
  stderrSha256: string;
}

export interface ExecutionAudit {
  schemaVersion: "execution-audit.v1";
  permissionProfileId: PermissionProfileId;
  worktreePath: string | null;
  commands: ExecutionCommandResult[];
}

export interface LensPlan {
  schemaVersion: "lens-plan.v1";
  planOrdinal: number;
  lensId: string;
  subLensId: string | null;
  lensVersion: string;
  lensClass: LensClass;
  required: boolean;
  blockingPolicy: BlockingPolicy;
  providerBindingId: string;
  permissionProfileId: PermissionProfileId;
  changedFiles: string[];
  fullContextFiles: string[];
  omittedFiles: string[];
  scopeDigest: string;
  executionCommands: ExecutionCommandSpec[];
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostUsd: number | null;
  overflowPolicy: OverflowPolicy;
}

export interface Finding {
  findingId: string;
  lensId: string;
  subLensId: string | null;
  ruleId: string;
  severity: Severity;
  blocking: boolean;
  file: string;
  startLine: number;
  endLine: number;
  summary: string;
  evidence: Record<string, unknown>;
  evidenceHash: string;
}

export interface LensResult {
  schemaVersion: "lens-result.v1";
  planOrdinal: number;
  lensId: string;
  subLensId: string | null;
  lensVersion: string;
  status: LensStatus;
  degraded: boolean;
  findings: Finding[];
  evidenceSummary: string[];
  usage: UsageMetrics;
  errorCodes: ErrorCode[];
  warningCodes: ErrorCode[];
  executionAudit: ExecutionAudit | null;
  adapterResponseHash: string;
}

export interface FinalVerdict {
  schemaVersion: "final-verdict.v1";
  status: VerdictStatus;
  degraded: boolean;
  rationale: string[];
  requiredLensIds: string[];
  missingRequiredLensIds: string[];
  failedRequiredLensIds: string[];
  blockingFindings: Finding[];
  errorCodes: ErrorCode[];
  aggregateUsage: UsageMetrics;
}

export interface SkillResult {
  schemaVersion: "skill-result.v1";
  executionKey: string;
  normalizedInputHash: string;
  lensPlans: LensPlan[];
  lensResults: LensResult[];
  finalVerdict: FinalVerdict;
}
