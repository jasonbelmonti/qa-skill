import type { ProviderBinding } from "../../contracts/skill-input";
import type { DispatchRetryPolicy } from "./types";

export class DispatchAttemptTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Dispatch attempt timed out after ${timeoutMs}ms`);
    this.name = "DispatchAttemptTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function buildDispatchRetryPolicy(binding: ProviderBinding): DispatchRetryPolicy {
  return {
    timeoutMs: binding.timeoutMs,
    retryMax: binding.retryMax,
    retryBackoffMs: [...binding.retryBackoffMs],
    maxAttempts: binding.retryMax + 1,
  };
}

export function retryDelayMsForAttempt(
  policy: DispatchRetryPolicy,
  failedAttemptOrdinal: number,
): number | null {
  if (failedAttemptOrdinal < 0 || failedAttemptOrdinal >= policy.retryMax) {
    return null;
  }

  if (policy.retryBackoffMs.length === 0) {
    return 0;
  }

  const index = Math.min(failedAttemptOrdinal, policy.retryBackoffMs.length - 1);
  return policy.retryBackoffMs[index]!;
}

export function sleepWithTimer(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export async function withTimeout<T>(
  execute: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abortController = new AbortController();
    let settled = false;
    let timeoutError: DispatchAttemptTimeoutError | null = null;

    const settleResolve = (value: T): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const settleReject = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      timeoutError = new DispatchAttemptTimeoutError(timeoutMs);
      abortController.abort(timeoutError);
    }, timeoutMs);

    let executionPromise: Promise<T>;
    try {
      executionPromise = execute(abortController.signal);
    } catch (error) {
      settleReject(error);
      return;
    }

    executionPromise.then(
      (value) => {
        if (timeoutError !== null) {
          settleReject(timeoutError);
          return;
        }
        settleResolve(value);
      },
      (error) => {
        if (timeoutError !== null) {
          settleReject(timeoutError);
          return;
        }
        settleReject(error);
      },
    );
  });
}
