import { stableStringify } from "../../utils/canonical-json";
import { EXIT_CODE_BY_ERROR } from "./constants";
import type { CliErrorCode } from "./types";

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;

  constructor(code: CliErrorCode, message: string) {
    super(message);
    this.code = code;
    this.exitCode = EXIT_CODE_BY_ERROR[code];
  }
}

export function isCliError(value: unknown): value is CliError {
  return value instanceof CliError;
}

export function toCliError(value: unknown): CliError {
  if (isCliError(value)) {
    return value;
  }
  return new CliError("ARTIFACT_WRITE_ERROR", "Unexpected runtime error");
}

export function formatCliErrorLine(error: CliError): string {
  return (
    stableStringify({
      code: error.code,
      message: error.message,
    }) + "\n"
  );
}
