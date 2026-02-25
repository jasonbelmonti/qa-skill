import { CliError } from "../errors";
import { DispatchAttemptTimeoutError } from "./retry-policy";
import type {
  DispatchErrorClassification,
  DispatchTerminalErrorCode,
} from "./types";

const RETRIABLE_ERROR_CODES = new Set<DispatchTerminalErrorCode>([
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_UNAVAILABLE",
]);

const TERMINAL_ERROR_CODES = new Set<DispatchTerminalErrorCode>([
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_AUTH_ERROR",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_USAGE_UNAVAILABLE",
  "ARTIFACT_SCHEMA_INVALID",
]);

function normalizeErrorCode(value: string): DispatchTerminalErrorCode | null {
  if (TERMINAL_ERROR_CODES.has(value as DispatchTerminalErrorCode)) {
    return value as DispatchTerminalErrorCode;
  }

  const normalized = value.toUpperCase();

  if (
    normalized.includes("TIMEOUT") ||
    normalized === "ETIMEDOUT" ||
    normalized === "ETIME"
  ) {
    return "PROVIDER_TIMEOUT";
  }
  if (normalized.includes("RATE_LIMIT") || normalized === "429") {
    return "PROVIDER_RATE_LIMIT";
  }
  if (
    normalized.includes("AUTH") ||
    normalized.includes("UNAUTHORIZED") ||
    normalized.includes("FORBIDDEN")
  ) {
    return "PROVIDER_AUTH_ERROR";
  }
  if (normalized.includes("USAGE")) {
    return "PROVIDER_USAGE_UNAVAILABLE";
  }

  return null;
}

function extractErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const code = (value as { code?: unknown }).code;
  if (typeof code === "string" && code.length > 0) {
    return code;
  }

  return null;
}

function extractErrorMessage(value: unknown): string {
  if (value instanceof Error && typeof value.message === "string") {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function hasTruthyTimeoutFlag(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Boolean((value as { timedOut?: unknown }).timedOut);
}

export function classifyDispatchError(error: unknown): DispatchErrorClassification {
  if (error instanceof DispatchAttemptTimeoutError || hasTruthyTimeoutFlag(error)) {
    return {
      code: "PROVIDER_TIMEOUT",
      retryable: true,
      reason: "attempt-timeout",
    };
  }

  if (error instanceof CliError && error.code === "ARTIFACT_SCHEMA_INVALID") {
    return {
      code: "ARTIFACT_SCHEMA_INVALID",
      retryable: false,
      reason: "artifact-schema-invalid",
    };
  }

  const code = extractErrorCode(error);
  if (code !== null) {
    const normalized = normalizeErrorCode(code);
    if (normalized !== null) {
      return {
        code: normalized,
        retryable: RETRIABLE_ERROR_CODES.has(normalized),
        reason: `error-code:${normalized}`,
      };
    }
  }

  const message = extractErrorMessage(error).toLowerCase();
  if (message.includes("rate limit")) {
    return {
      code: "PROVIDER_RATE_LIMIT",
      retryable: true,
      reason: "message-rate-limit",
    };
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return {
      code: "PROVIDER_TIMEOUT",
      retryable: true,
      reason: "message-timeout",
    };
  }
  if (
    message.includes("auth") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  ) {
    return {
      code: "PROVIDER_AUTH_ERROR",
      retryable: false,
      reason: "message-auth",
    };
  }

  return {
    code: "PROVIDER_UNAVAILABLE",
    retryable: true,
    reason: "fallback-unavailable",
  };
}
