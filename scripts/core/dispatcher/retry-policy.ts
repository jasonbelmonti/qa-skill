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

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DispatchAttemptTimeoutError(timeoutMs));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
