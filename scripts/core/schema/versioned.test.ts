import { expect, test } from "bun:test";

import { CliError } from "../errors";
import { assertVersionedSchema, schemaKeyFromVersion } from "./versioned";

test("schemaKeyFromVersion only accepts own schema-version keys", () => {
  expect(schemaKeyFromVersion("skill-input.v1")).toBe("skill-input.v1");
  expect(schemaKeyFromVersion("toString")).toBeNull();
  expect(schemaKeyFromVersion("__proto__")).toBeNull();
});

test("assertVersionedSchema rejects unsupported schema versions deterministically", () => {
  try {
    assertVersionedSchema(
      {
        schemaVersion: "toString",
      },
      "CONFIG_VALIDATION_ERROR",
    );

    throw new Error("Expected assertVersionedSchema to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    const cliError = error as CliError;
    expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(cliError.message).toContain("Unsupported schemaVersion");
  }
});
