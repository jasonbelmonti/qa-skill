import { expect, test } from "bun:test";

import type { LensPlan, LensResult } from "../../contracts/artifacts";
import type { ProviderBinding, SkillInput } from "../../contracts/skill-input";
import { stableStringify } from "../../utils/canonical-json";
import { validateSchema } from "../schema/validate";
import {
  buildDispatchRetryPolicy,
  buildTerminalLensResult,
  classifyDispatchError,
  retryDelayMsForAttempt,
  runDispatchTaskWithRetry,
} from "./retry";
import type { DispatchTask, DispatchTerminalErrorCode } from "./types";

const HASH = "a".repeat(64);

function buildProviderBinding(
  bindingId: string,
  overrides: Partial<ProviderBinding> = {},
): ProviderBinding {
  return {
    bindingId,
    adapterId: "openai-codex",
    adapterVersion: "2026-02-01",
    modelId: "o4-mini",
    temperature: 0,
    topP: 1,
    maxTokens: 8000,
    seed: null,
    timeoutMs: 50,
    retryMax: 2,
    retryBackoffMs: [500, 1500],
    ...overrides,
  };
}

function buildSkillInput(overrides: Partial<SkillInput> = {}): SkillInput {
  return {
    schemaVersion: "skill-input.v1",
    repoId: "acme/qa-skill",
    repoRoot: "/repo",
    vcs: "git",
    baseRef: "origin/main",
    headRef: "HEAD",
    runMode: "strict",
    requestedLensIds: null,
    maxConcurrency: 4,
    allowExecutionLensClasses: [],
    permissionProfiles: [
      {
        profileId: "read_only",
        readOnly: true,
        allowNetwork: false,
        worktreeMode: "none",
        allowedCommandPrefixes: [],
        maxCommandsPerPlan: 0,
        commandTimeoutMs: 0,
        maxStdoutBytes: 0,
        maxStderrBytes: 0,
      },
    ],
    defaultPermissionProfileId: "read_only",
    artifactRoot: ".qa-skill",
    runBudgetMaxTokens: 300000,
    runBudgetMaxCostUsd: 12,
    providerBindings: [buildProviderBinding("binding-a")],
    configHash: HASH,
    ...overrides,
  };
}

function buildPlan(overrides: Partial<LensPlan> = {}): LensPlan {
  return {
    schemaVersion: "lens-plan.v1",
    planOrdinal: 3,
    lensId: "consistency-core",
    subLensId: "architecture-drift",
    lensVersion: "1.0.0",
    lensClass: "consistency",
    required: true,
    blockingPolicy: "mixed",
    providerBindingId: "binding-a",
    permissionProfileId: "read_only",
    changedFiles: ["src/app.ts"],
    fullContextFiles: [],
    omittedFiles: [],
    scopeDigest: "b".repeat(64),
    executionCommands: [],
    maxInputTokens: 8000,
    maxOutputTokens: 8000,
    maxCostUsd: 1,
    overflowPolicy: "stop",
    ...overrides,
  };
}

function buildTask(overrides: Partial<DispatchTask> = {}): DispatchTask {
  return {
    queueOrdinal: 0,
    plan: buildPlan(),
    ...overrides,
  };
}

function buildSuccessfulResult(
  plan: LensPlan,
  overrides: Partial<LensResult> = {},
): LensResult {
  return {
    schemaVersion: "lens-result.v1",
    planOrdinal: plan.planOrdinal,
    lensId: plan.lensId,
    subLensId: plan.subLensId,
    lensVersion: plan.lensVersion,
    status: "completed",
    degraded: false,
    findings: [],
    evidenceSummary: ["ok"],
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.02,
      unavailableReason: null,
    },
    errorCodes: [],
    warningCodes: [],
    executionAudit: null,
    adapterResponseHash: HASH,
    ...overrides,
  };
}

function errorWithCode(code: DispatchTerminalErrorCode): Error & { code: string } {
  const error = new Error(`error-${code}`) as Error & { code: string };
  error.code = code;
  return error;
}

function errorWithRawCode(code: string): Error & { code: string } {
  const error = new Error(`error-${code}`) as Error & { code: string };
  error.code = code;
  return error;
}

test("buildDispatchRetryPolicy uses deterministic binding values", () => {
  const policy = buildDispatchRetryPolicy(
    buildProviderBinding("binding-a", {
      timeoutMs: 1234,
      retryMax: 2,
      retryBackoffMs: [500, 1500],
    }),
  );

  expect(policy).toEqual({
    timeoutMs: 1234,
    retryMax: 2,
    retryBackoffMs: [500, 1500],
    maxAttempts: 3,
  });
});

test("retryDelayMsForAttempt returns deterministic schedule", () => {
  const policy = buildDispatchRetryPolicy(buildProviderBinding("binding-a"));

  expect(retryDelayMsForAttempt(policy, -1)).toBeNull();
  expect(retryDelayMsForAttempt(policy, 0)).toBe(500);
  expect(retryDelayMsForAttempt(policy, 1)).toBe(1500);
  expect(retryDelayMsForAttempt(policy, 2)).toBeNull();
});

test("classifyDispatchError maps timeout/rate-limit/auth/unknown deterministically", () => {
  expect(classifyDispatchError({ timedOut: true })).toMatchObject({
    code: "PROVIDER_TIMEOUT",
    retryable: true,
    reason: "attempt-timeout",
  });

  expect(classifyDispatchError(errorWithCode("PROVIDER_RATE_LIMIT"))).toMatchObject({
    code: "PROVIDER_RATE_LIMIT",
    retryable: true,
  });

  expect(classifyDispatchError(new Error("unauthorized token"))).toMatchObject({
    code: "PROVIDER_AUTH_ERROR",
    retryable: false,
  });

  expect(classifyDispatchError(new Error("socket reset"))).toMatchObject({
    code: "PROVIDER_UNAVAILABLE",
    retryable: true,
  });

  expect(classifyDispatchError(errorWithRawCode("artifact_schema_invalid"))).toMatchObject({
    code: "ARTIFACT_SCHEMA_INVALID",
    retryable: false,
  });

  expect(classifyDispatchError(errorWithRawCode("401"))).toMatchObject({
    code: "PROVIDER_AUTH_ERROR",
    retryable: false,
  });

  expect(classifyDispatchError(errorWithRawCode("403"))).toMatchObject({
    code: "PROVIDER_AUTH_ERROR",
    retryable: false,
  });
});

test("runDispatchTaskWithRetry retries retriable errors and then succeeds", async () => {
  const task = buildTask();
  const sleepCalls: number[] = [];
  let calls = 0;

  const run = await runDispatchTaskWithRetry({
    skillInput: buildSkillInput(),
    primaryProviderBinding: buildProviderBinding("binding-a"),
    task,
    sleepMs: async (durationMs: number) => {
      sleepCalls.push(durationMs);
    },
    execute: async () => {
      calls += 1;
      if (calls === 1) {
        throw errorWithCode("PROVIDER_RATE_LIMIT");
      }
      return buildSuccessfulResult(task.plan);
    },
  });

  expect(calls).toBe(2);
  expect(sleepCalls).toEqual([500]);
  expect(run.attemptsUsed).toBe(2);
  expect(run.terminalFailure).toBe(false);
  expect(run.result.status).toBe("completed");
});

test("runDispatchTaskWithRetry stops immediately on non-retriable auth errors", async () => {
  const task = buildTask();
  const sleepCalls: number[] = [];
  let calls = 0;

  const run = await runDispatchTaskWithRetry({
    skillInput: buildSkillInput(),
    primaryProviderBinding: buildProviderBinding("binding-a"),
    task,
    sleepMs: async (durationMs: number) => {
      sleepCalls.push(durationMs);
    },
    execute: async () => {
      calls += 1;
      throw errorWithCode("PROVIDER_AUTH_ERROR");
    },
  });

  expect(calls).toBe(1);
  expect(sleepCalls).toEqual([]);
  expect(run.attemptsUsed).toBe(1);
  expect(run.terminalFailure).toBe(true);
  expect(run.result.status).toBe("failed");
  expect(run.result.errorCodes).toEqual(["PROVIDER_AUTH_ERROR"]);
  expect(validateSchema("lens-result.v1", run.result).valid).toBe(true);
});

test("runDispatchTaskWithRetry maps attempt timeout to deterministic terminal code", async () => {
  const task = buildTask();
  const sleepCalls: number[] = [];

  const run = await runDispatchTaskWithRetry({
    skillInput: buildSkillInput(),
    primaryProviderBinding: buildProviderBinding("binding-a", { timeoutMs: 1 }),
    task,
    sleepMs: async (durationMs: number) => {
      sleepCalls.push(durationMs);
    },
    execute: async () => {
      return await new Promise<LensResult>(() => {
        // Never resolve to exercise deterministic timeout path.
      });
    },
  });

  expect(sleepCalls).toEqual([500, 1500]);
  expect(run.attemptsUsed).toBe(3);
  expect(run.terminalFailure).toBe(true);
  expect(run.result.errorCodes).toEqual(["PROVIDER_TIMEOUT"]);
  expect(validateSchema("lens-result.v1", run.result).valid).toBe(true);
});

test("runDispatchTaskWithRetry aborts timed-out attempts before retrying", async () => {
  const task = buildTask();
  let inFlight = 0;
  const attemptsObserved: number[] = [];
  const abortSignals: AbortSignal[] = [];

  const run = await runDispatchTaskWithRetry({
    skillInput: buildSkillInput(),
    primaryProviderBinding: buildProviderBinding("binding-a", { timeoutMs: 1 }),
    task,
    sleepMs: async () => undefined,
    execute: async (attemptInput) => {
      attemptsObserved.push(attemptInput.attemptOrdinal);
      abortSignals.push(attemptInput.abortSignal);

      if (attemptInput.attemptOrdinal === 1) {
        expect(inFlight).toBe(0);
        return buildSuccessfulResult(task.plan);
      }

      inFlight += 1;

      return await new Promise<LensResult>((_, reject) => {
        attemptInput.abortSignal.addEventListener(
          "abort",
          () => {
            inFlight -= 1;
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
    },
  });

  expect(attemptsObserved).toEqual([0, 1]);
  expect(abortSignals[0]?.aborted).toBe(true);
  expect(run.terminalFailure).toBe(false);
  expect(run.result.status).toBe("completed");
});

test("runDispatchTaskWithRetry treats lowercase terminal schema code as non-retriable", async () => {
  const task = buildTask();
  const attemptsObserved: number[] = [];

  const run = await runDispatchTaskWithRetry({
    skillInput: buildSkillInput(),
    primaryProviderBinding: buildProviderBinding("binding-a"),
    task,
    sleepMs: async () => undefined,
    execute: async (attemptInput) => {
      attemptsObserved.push(attemptInput.attemptOrdinal);
      throw errorWithRawCode("artifact_schema_invalid");
    },
  });

  expect(attemptsObserved).toEqual([0]);
  expect(run.terminalFailure).toBe(true);
  expect(run.result.errorCodes).toEqual(["ARTIFACT_SCHEMA_INVALID"]);
});

test("runDispatchTaskWithRetry treats 401 error code as non-retriable auth failure", async () => {
  const task = buildTask();
  const attemptsObserved: number[] = [];

  const run = await runDispatchTaskWithRetry({
    skillInput: buildSkillInput(),
    primaryProviderBinding: buildProviderBinding("binding-a"),
    task,
    sleepMs: async () => undefined,
    execute: async (attemptInput) => {
      attemptsObserved.push(attemptInput.attemptOrdinal);
      throw errorWithRawCode("401");
    },
  });

  expect(attemptsObserved).toEqual([0]);
  expect(run.terminalFailure).toBe(true);
  expect(run.result.errorCodes).toEqual(["PROVIDER_AUTH_ERROR"]);
});

test("runDispatchTaskWithRetry treats invalid executor payload as terminal schema error", async () => {
  const task = buildTask();
  const run = await runDispatchTaskWithRetry({
    skillInput: buildSkillInput(),
    primaryProviderBinding: buildProviderBinding("binding-a"),
    task,
    execute: async () => {
      return {} as LensResult;
    },
  });

  expect(run.attemptsUsed).toBe(1);
  expect(run.terminalFailure).toBe(true);
  expect(run.result.errorCodes).toEqual(["ARTIFACT_SCHEMA_INVALID"]);
});

test("runDispatchTaskWithRetry treats mismatched lens identity as terminal schema error", async () => {
  const task = buildTask();
  const run = await runDispatchTaskWithRetry({
    skillInput: buildSkillInput(),
    primaryProviderBinding: buildProviderBinding("binding-a"),
    task,
    execute: async () => {
      return buildSuccessfulResult(task.plan, {
        lensId: "different-lens-id",
      });
    },
  });

  expect(run.attemptsUsed).toBe(1);
  expect(run.terminalFailure).toBe(true);
  expect(run.result.errorCodes).toEqual(["ARTIFACT_SCHEMA_INVALID"]);
});

test("buildTerminalLensResult uses degraded status for non-required best-effort mode", () => {
  const result = buildTerminalLensResult({
    skillInput: buildSkillInput({ runMode: "best_effort" }),
    task: buildTask({
      plan: buildPlan({
        required: false,
      }),
    }),
    attemptsUsed: 1,
    classification: {
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      reason: "test",
    },
  });

  expect(result.status).toBe("degraded");
  expect(result.degraded).toBe(true);
  expect(result.errorCodes).toEqual(["PROVIDER_UNAVAILABLE"]);
});

test("terminal fallback result is deterministic across repeat runs", async () => {
  const task = buildTask();
  const outputs: string[] = [];

  for (let index = 0; index < 20; index += 1) {
    const run = await runDispatchTaskWithRetry({
      skillInput: buildSkillInput(),
      primaryProviderBinding: buildProviderBinding("binding-a"),
      task,
      sleepMs: async () => undefined,
      execute: async () => {
        throw errorWithCode("PROVIDER_AUTH_ERROR");
      },
    });
    outputs.push(stableStringify(run.result));
  }

  expect(new Set(outputs).size).toBe(1);
});
