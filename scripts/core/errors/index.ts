import { stableStringify } from "../../utils/canonical-json";
import { SchemaRegistryError } from "../schema/registry";
import { EXIT_CODE_BY_ERROR } from "./constants";
import type { CliErrorCode, CliErrorOptions } from "./types";

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;
  readonly deterministicCode?: CliErrorOptions["deterministicCode"];

  constructor(code: CliErrorCode, message: string, options: CliErrorOptions = {}) {
    super(message);
    this.code = code;
    this.exitCode = EXIT_CODE_BY_ERROR[code];
    this.deterministicCode = options.deterministicCode;
  }
}

export function isCliError(value: unknown): value is CliError {
  return value instanceof CliError;
}

export function toCliError(value: unknown): CliError {
  if (isCliError(value)) {
    return value;
  }

  if (value instanceof SchemaRegistryError) {
    return new CliError("ARTIFACT_SCHEMA_INVALID", value.message);
  }

  return new CliError("ARTIFACT_WRITE_ERROR", "Unexpected runtime error");
}

export function formatCliErrorLine(error: CliError): string {
  const payload: {
    code: CliErrorCode;
    message: string;
    deterministicCode?: CliErrorOptions["deterministicCode"];
  } = {
    code: error.code,
    message: error.message,
  };

  if (error.deterministicCode !== undefined) {
    payload.deterministicCode = error.deterministicCode;
  }

  return `${stableStringify(payload)}\n`;
}
