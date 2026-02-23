import { expect, test } from "bun:test";

import type { LensDefinition } from "./contracts";
import type { LoadedLensRegistry } from "./loader";
import { resolveRequestedLensIds } from "./requested-lens-resolver";
import { CliError } from "../core/errors";

function buildLensDefinition(
  lensId: string,
  lensClass: LensDefinition["lensClass"],
): LensDefinition {
  return {
    lensId,
    lensVersion: "1.0.0",
    lensClass,
    title: lensId,
    description: `${lensId} checks`,
    requiredByDefault: lensId === "consistency-core",
    defaultPermissionProfileId: "read_only",
    trigger: {
      includeGlobs: ["**/*.ts"],
      excludeGlobs: [],
      pathPrefixes: ["src/"],
      symbolHints: [],
      minConfidence: 0.5,
    },
    subLenses: [],
  };
}

function buildLoadedRegistry(): LoadedLensRegistry {
  const lenses = [
    buildLensDefinition("consistency-core", "consistency"),
    buildLensDefinition("security-core", "security"),
    buildLensDefinition("style-core", "style"),
  ];

  const lensesById = lenses.reduce(
    (accumulator, lens) => {
      accumulator[lens.lensId] = lens;
      return accumulator;
    },
    Object.create(null) as Record<string, LensDefinition>,
  );

  return {
    manifestPath: "/repo/skill/manifest.v1.json",
    registryPath: "/repo/skill/registry.v1.json",
    manifest: {
      schemaVersion: "skill-manifest.v1",
      skillId: "qa-skill",
      skillVersion: "1.0.0",
      name: "qa-skill",
      summary: "Deterministic QA skill",
      registryPath: "skill/registry.v1.json",
      defaultRunMode: "strict",
      supportedLensClasses: ["consistency", "security", "style"],
      deterministicOrdering: {
        lenses: "lensId ASC",
        subLenses: "subLensId ASC",
      },
    },
    registry: {
      schemaVersion: "skill-registry.v1",
      skillId: "qa-skill",
      skillVersion: "1.0.0",
      orderingRules: {
        lenses: "lensId ASC",
        subLenses: "subLensId ASC",
      },
      lenses,
    },
    lenses,
    lensesById,
  };
}

test("resolveRequestedLensIds returns all lenses when requestedLensIds is null", () => {
  const registry = buildLoadedRegistry();

  const result = resolveRequestedLensIds(registry, null);

  expect(result.selectedLensIds).toEqual([
    "consistency-core",
    "security-core",
    "style-core",
  ]);
  expect(result.selectedLenses.map((lens) => lens.lensId)).toEqual(
    result.selectedLensIds,
  );
});

test("resolveRequestedLensIds returns requested subset in deterministic registry order", () => {
  const registry = buildLoadedRegistry();

  const result = resolveRequestedLensIds(registry, [
    "style-core",
    "consistency-core",
  ]);

  expect(result.selectedLensIds).toEqual(["consistency-core", "style-core"]);
  expect(result.selectedLenses.map((lens) => lens.lensId)).toEqual(
    result.selectedLensIds,
  );
});

test("resolveRequestedLensIds fails deterministically for unknown and duplicate ids", () => {
  const registry = buildLoadedRegistry();
  const requested = ["unknown-lens", "style-core", "unknown-lens"];

  const capture = () => {
    try {
      resolveRequestedLensIds(registry, requested);
      throw new Error("Expected resolver to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cliError = error as CliError;
      expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
      return cliError.message;
    }
  };

  const first = capture();
  const second = capture();

  expect(first).toBe(second);
  expect(first).toContain("requestedLensIds[0]");
  expect(first).toContain("unknown lensId (unknown-lens)");
  expect(first).toContain("requestedLensIds[2]");
  expect(first).toContain("duplicate lensId (unknown-lens)");
});
