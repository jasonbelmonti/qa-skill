import { readFileSync } from "node:fs";

import { expect, test } from "bun:test";

import { CliError } from "../errors";
import { assertVersionedSchema, schemaKeyFromVersion } from "./versioned";

test("schemaKeyFromVersion only accepts own schema-version keys", () => {
  expect(schemaKeyFromVersion("skill-manifest.v1")).toBe("skill-manifest.v1");
  expect(schemaKeyFromVersion("skill-registry.v1")).toBe("skill-registry.v1");
  expect(schemaKeyFromVersion("skill-input.v1")).toBe("skill-input.v1");
  expect(schemaKeyFromVersion("toString")).toBeNull();
  expect(schemaKeyFromVersion("__proto__")).toBeNull();
});

function loadJsonFixture(relativePath: string): unknown {
  const fixturePath = new URL(relativePath, import.meta.url);
  const raw = readFileSync(fixturePath, "utf8");
  return JSON.parse(raw) as unknown;
}

test("assertVersionedSchema accepts manifest and registry schema versions", () => {
  const manifest = loadJsonFixture("../../../skill/manifest.v1.json");
  const registry = loadJsonFixture("../../../skill/registry.v1.json");

  expect(assertVersionedSchema(manifest, "CONFIG_VALIDATION_ERROR")).toBe(
    "skill-manifest.v1",
  );
  expect(assertVersionedSchema(registry, "CONFIG_VALIDATION_ERROR")).toBe(
    "skill-registry.v1",
  );
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
