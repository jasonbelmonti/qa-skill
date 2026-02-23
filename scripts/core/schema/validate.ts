import type { ErrorObject } from "ajv";

import { stableStringify } from "../../utils/canonical-json";
import { CliError } from "../errors";
import type { CliErrorCode } from "../errors/types";
import { getSchemaValidator, type SchemaKey } from "./registry";

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export interface NormalizedValidationError {
  instancePath: string;
  keyword: string;
  schemaPath: string;
  params: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: NormalizedValidationError[];
}

function normalizeError(error: ErrorObject): NormalizedValidationError {
  return {
    instancePath: error.instancePath.length > 0 ? error.instancePath : "/",
    keyword: error.keyword,
    schemaPath: error.schemaPath,
    params: stableStringify(error.params ?? {}),
    message: error.message ?? "",
  };
}

function compareValidationErrors(
  left: NormalizedValidationError,
  right: NormalizedValidationError,
): number {
  return (
    compareText(left.instancePath, right.instancePath) ||
    compareText(left.keyword, right.keyword) ||
    compareText(left.schemaPath, right.schemaPath) ||
    compareText(left.params, right.params) ||
    compareText(left.message, right.message)
  );
}

export function validateSchema(
  schemaKey: SchemaKey,
  payload: unknown,
): SchemaValidationResult {
  const validator = getSchemaValidator(schemaKey);
  const valid = validator(payload) as boolean;

  if (valid) {
    return {
      valid: true,
      errors: [],
    };
  }

  const errors = (validator.errors ?? [])
    .map(normalizeError)
    .sort(compareValidationErrors);

  return {
    valid: false,
    errors,
  };
}

export function formatValidationErrors(
  schemaKey: SchemaKey,
  errors: readonly NormalizedValidationError[],
): string {
  if (errors.length === 0) {
    return `Schema validation failed for ${schemaKey} with no validation issues reported`;
  }

  const details = errors
    .map(
      (error, index) =>
        `#${index + 1} instancePath=${error.instancePath} keyword=${error.keyword} schemaPath=${error.schemaPath} params=${error.params} message=${error.message}`,
    )
    .join("; ");

  return `Schema validation failed for ${schemaKey}: ${details}`;
}

export function assertSchema(
  schemaKey: SchemaKey,
  payload: unknown,
  cliCode: CliErrorCode,
): void {
  const result = validateSchema(schemaKey, payload);
  if (!result.valid) {
    throw new CliError(cliCode, formatValidationErrors(schemaKey, result.errors));
  }
}
