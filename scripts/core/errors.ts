import { stableStringify } from "./canonical-json";

export type CliErrorCode =
  | "USAGE_ERROR"
  | "CONFIG_READ_ERROR"
  | "CONFIG_PARSE_ERROR"
  | "CONFIG_VALIDATION_ERROR"
  | "OUT_DIR_NON_EMPTY"
  | "ARTIFACT_WRITE_ERROR";

export const EXIT_CODE_BY_ERROR: Record<CliErrorCode, number> = {
  USAGE_ERROR: 2,
  CONFIG_READ_ERROR: 3,
  CONFIG_PARSE_ERROR: 3,
  CONFIG_VALIDATION_ERROR: 3,
  OUT_DIR_NON_EMPTY: 4,
  ARTIFACT_WRITE_ERROR: 5,
};

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
