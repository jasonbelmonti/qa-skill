import { CliError } from "../errors";
import { assertSchema } from "../schema/validate";
import { classifyDispatchError } from "./error-classification";
import {
  DispatchAttemptTimeoutError,
  buildDispatchRetryPolicy,
  retryDelayMsForAttempt,
  sleepWithTimer,
  withTimeout,
} from "./retry-policy";
import { assertLensResultIdentity, buildTerminalLensResult } from "./terminal-result";
import type { RunDispatchTaskInput, RunDispatchTaskResult } from "./types";

async function waitForTimeoutCleanup(error: unknown, maxWaitMs: number): Promise<void> {
  if (!(error instanceof DispatchAttemptTimeoutError)) {
    return;
  }
  if (maxWaitMs <= 0) {
    return;
  }

  await Promise.race([
    error.cleanupSettled.then(
      () => undefined,
      () => undefined,
    ),
    sleepWithTimer(maxWaitMs),
  ]);
}

export async function runDispatchTaskWithRetry(
  input: RunDispatchTaskInput,
): Promise<RunDispatchTaskResult> {
  const policy = buildDispatchRetryPolicy(input.primaryProviderBinding);
  const sleepMs = input.sleepMs ?? sleepWithTimer;

  for (let attemptOrdinal = 0; attemptOrdinal < policy.maxAttempts; attemptOrdinal += 1) {
    try {
      const result = await withTimeout(
        (abortSignal) =>
          input.execute({
            skillInput: input.skillInput,
            primaryProviderBinding: input.primaryProviderBinding,
            task: input.task,
            attemptOrdinal,
            abortSignal,
          }),
        policy.timeoutMs,
      );

      assertSchema("lens-result.v1", result, "ARTIFACT_SCHEMA_INVALID");
      assertLensResultIdentity(input.task.plan, result);

      return {
        result,
        attemptsUsed: attemptOrdinal + 1,
        terminalFailure: false,
      };
    } catch (error) {
      const classification = classifyDispatchError(error);
      const shouldRetry = classification.retryable && attemptOrdinal < policy.retryMax;
      if (shouldRetry) {
        const delayMs = retryDelayMsForAttempt(policy, attemptOrdinal);
        const cleanupWaitMs = Math.max(policy.timeoutMs, delayMs ?? 0);
        await Promise.all([
          waitForTimeoutCleanup(error, cleanupWaitMs),
          delayMs !== null && delayMs > 0 ? sleepMs(delayMs) : Promise.resolve(),
        ]);
        continue;
      }

      const usageUnavailableReason =
        classification.code === "PROVIDER_USAGE_UNAVAILABLE"
          ? "MISSING_USAGE_DATA"
          : undefined;

      return {
        result: buildTerminalLensResult({
          skillInput: input.skillInput,
          task: input.task,
          attemptsUsed: attemptOrdinal + 1,
          classification,
          usageUnavailableReason,
        }),
        attemptsUsed: attemptOrdinal + 1,
        terminalFailure: true,
      };
    }
  }

  throw new CliError(
    "ARTIFACT_SCHEMA_INVALID",
    "Dispatcher retry loop exhausted without producing a deterministic terminal result",
  );
}
