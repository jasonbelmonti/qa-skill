import { readFileSync } from "node:fs";

import type { AnySchemaObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";

export class SchemaRegistryError extends Error {}

export const REGISTERED_SCHEMA_KEYS = [
  "qa-run-config.v1",
  "skill-manifest.v1",
  "skill-registry.v1",
  "skill-input.v1",
  "lens-plan.v1",
  "lens-result.v1",
  "final-verdict.v1",
  "skill-result.v1",
  "execution-audit.v1",
] as const;

export type SchemaKey = (typeof REGISTERED_SCHEMA_KEYS)[number];

const COMMON_SCHEMA_RELATIVE_PATH = "../../../schemas/v1/defs/common.v1.json";

const SCHEMA_RELATIVE_PATHS: Record<SchemaKey, string> = {
  "qa-run-config.v1": "../../../schemas/v1/qa-run-config.v1.json",
  "skill-manifest.v1": "../../../schemas/v1/skill-manifest.v1.json",
  "skill-registry.v1": "../../../schemas/v1/skill-registry.v1.json",
  "skill-input.v1": "../../../schemas/v1/skill-input.v1.json",
  "lens-plan.v1": "../../../schemas/v1/lens-plan.v1.json",
  "lens-result.v1": "../../../schemas/v1/lens-result.v1.json",
  "final-verdict.v1": "../../../schemas/v1/final-verdict.v1.json",
  "skill-result.v1": "../../../schemas/v1/skill-result.v1.json",
  "execution-audit.v1": "../../../schemas/v1/execution-audit.v1.json",
};

function loadSchema(relativePath: string): AnySchemaObject {
  const schemaPath = new URL(relativePath, import.meta.url);

  let raw: string;
  try {
    raw = readFileSync(schemaPath, "utf8");
  } catch {
    throw new SchemaRegistryError(`Unable to read schema file: ${schemaPath.pathname}`);
  }

  try {
    return JSON.parse(raw) as AnySchemaObject;
  } catch {
    throw new SchemaRegistryError(`Schema file is not valid JSON: ${schemaPath.pathname}`);
  }
}

function requireSchemaId(schema: AnySchemaObject, key: SchemaKey): string {
  if (typeof schema.$id !== "string" || schema.$id.length === 0) {
    throw new SchemaRegistryError(`Missing $id for schema: ${key}`);
  }
  return schema.$id;
}

let cachedValidators: Record<SchemaKey, ValidateFunction> | null = null;

function buildValidators(): Record<SchemaKey, ValidateFunction> {
  const commonSchema = loadSchema(COMMON_SCHEMA_RELATIVE_PATH);

  const schemaByKey = REGISTERED_SCHEMA_KEYS.reduce(
    (accumulator, key) => {
      accumulator[key] = loadSchema(SCHEMA_RELATIVE_PATHS[key]);
      return accumulator;
    },
    {} as Record<SchemaKey, AnySchemaObject>,
  );

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: true,
    validateFormats: false,
  });

  ajv.addSchema(commonSchema);

  for (const key of REGISTERED_SCHEMA_KEYS) {
    ajv.addSchema(schemaByKey[key]);
  }

  return REGISTERED_SCHEMA_KEYS.reduce(
    (accumulator, key) => {
      const schemaId = requireSchemaId(schemaByKey[key], key);
      const validator = ajv.getSchema(schemaId);
      if (!validator) {
        throw new SchemaRegistryError(
          `Unable to compile schema validator for: ${key}`,
        );
      }

      accumulator[key] = validator;
      return accumulator;
    },
    {} as Record<SchemaKey, ValidateFunction>,
  );
}

function getValidatorMap(): Record<SchemaKey, ValidateFunction> {
  if (cachedValidators === null) {
    cachedValidators = buildValidators();
  }

  return cachedValidators;
}

export function getRegisteredSchemaKeys(): readonly SchemaKey[] {
  return REGISTERED_SCHEMA_KEYS;
}

export function getSchemaValidator(schemaKey: SchemaKey): ValidateFunction {
  return getValidatorMap()[schemaKey];
}
