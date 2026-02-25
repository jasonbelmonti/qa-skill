import type { LensPlan, LensResult } from "../../contracts/artifacts";
import type { ProviderBinding, SkillInput } from "../../contracts/skill-input";
import type { ErrorCode, UsageUnavailableReason } from "../../contracts/common";

export interface DispatchTask {
  queueOrdinal: number;
  plan: LensPlan;
}

export interface BuildDispatcherPreflightInput {
  skillInput: SkillInput;
  lensPlans: readonly LensPlan[];
}

export interface BuildDispatcherPreflightResult {
  primaryProviderBinding: ProviderBinding;
  tasks: DispatchTask[];
}

export interface DispatchAttemptInput {
  skillInput: SkillInput;
  primaryProviderBinding: ProviderBinding;
  task: DispatchTask;
  attemptOrdinal: number;
  abortSignal: AbortSignal;
}

export type DispatchLensPlanExecutor = (
  input: DispatchAttemptInput,
) => Promise<LensResult>;

export interface DispatchRetryPolicy {
  timeoutMs: number;
  retryMax: number;
  retryBackoffMs: readonly number[];
  maxAttempts: number;
}

export type DispatchTerminalErrorCode = Extract<
  ErrorCode,
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_AUTH_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_USAGE_UNAVAILABLE"
  | "ARTIFACT_SCHEMA_INVALID"
>;

export interface DispatchErrorClassification {
  code: DispatchTerminalErrorCode;
  retryable: boolean;
  reason: string;
}

export interface RunDispatchTaskInput {
  skillInput: SkillInput;
  primaryProviderBinding: ProviderBinding;
  task: DispatchTask;
  execute: DispatchLensPlanExecutor;
  sleepMs?: (durationMs: number) => Promise<void>;
}

export interface RunDispatchTaskResult {
  result: LensResult;
  attemptsUsed: number;
  terminalFailure: boolean;
}

export interface TerminalLensResultInput {
  skillInput: SkillInput;
  task: DispatchTask;
  attemptsUsed: number;
  classification: DispatchErrorClassification;
  usageUnavailableReason?: UsageUnavailableReason;
}
