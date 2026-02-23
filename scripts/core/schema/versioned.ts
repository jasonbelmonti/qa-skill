import type { SchemaVersion } from "../../contracts/skill-input";
import { CliError } from "../errors";
import type { CliErrorCode } from "../errors/types";
import type { SchemaKey } from "./registry";
import { assertSchema } from "./validate";

const SCHEMA_KEY_BY_VERSION: Record<SchemaVersion, SchemaKey> = {
  "skill-input.v1": "skill-input.v1",
  "lens-plan.v1": "lens-plan.v1",
  "lens-result.v1": "lens-result.v1",
  "final-verdict.v1": "final-verdict.v1",
  "skill-result.v1": "skill-result.v1",
  "execution-audit.v1": "execution-audit.v1",
};

interface VersionedPayload {
  schemaVersion?: unknown;
}

export function schemaKeyFromVersion(schemaVersion: string): SchemaKey | null {
  if (Object.prototype.hasOwnProperty.call(SCHEMA_KEY_BY_VERSION, schemaVersion)) {
    return SCHEMA_KEY_BY_VERSION[schemaVersion as SchemaVersion];
  }

  return null;
}

export function assertVersionedSchema(
  payload: unknown,
  cliCode: CliErrorCode,
  expectedVersion?: SchemaVersion,
): SchemaKey {
  if (typeof payload !== "object" || payload === null) {
    throw new CliError(cliCode, "Versioned payload must be a non-null object");
  }

  const schemaVersion = (payload as VersionedPayload).schemaVersion;

  if (typeof schemaVersion !== "string" || schemaVersion.length === 0) {
    throw new CliError(cliCode, "Versioned payload must include schemaVersion");
  }

  if (expectedVersion !== undefined && schemaVersion !== expectedVersion) {
    throw new CliError(
      cliCode,
      `Expected schemaVersion ${expectedVersion} but received ${schemaVersion}`,
    );
  }

  const schemaKey = schemaKeyFromVersion(schemaVersion);
  if (schemaKey === null) {
    throw new CliError(cliCode, `Unsupported schemaVersion: ${schemaVersion}`);
  }

  assertSchema(schemaKey, payload, cliCode);
  return schemaKey;
}
