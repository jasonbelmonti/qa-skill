import { readFileSync } from "node:fs";

import { expect, test } from "bun:test";

import { CliError } from "../errors";
import {
  getRegisteredSchemaKeys,
  type SchemaKey,
} from "./registry";
import {
  assertSchema,
  type NormalizedValidationError,
  validateSchema,
} from "./validate";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
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

function buildUsageMetrics() {
  return {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    costUsd: 0.01,
    unavailableReason: null,
  };
}

function buildPermissionProfile() {
  return {
    profileId: "read_only",
    readOnly: true,
    allowNetwork: false,
    worktreeMode: "none",
    allowedCommandPrefixes: [["bun", "run"]],
    maxCommandsPerPlan: 1,
    commandTimeoutMs: 1,
    maxStdoutBytes: 1,
    maxStderrBytes: 1,
  };
}

function buildProviderBinding() {
  return {
    bindingId: "binding-primary",
    adapterId: "openai-codex",
    adapterVersion: "2026-02-01",
    modelId: "o4-mini",
    temperature: 0,
    topP: 1,
    maxTokens: 8000,
    seed: null,
    timeoutMs: 60000,
    retryMax: 2,
    retryBackoffMs: [500, 1500],
  };
}

function buildFinding() {
  return {
    findingId: "finding-1",
    lensId: "consistency",
    subLensId: null,
    ruleId: "rule-1",
    severity: "high",
    blocking: true,
    file: "src/index.ts",
    startLine: 10,
    endLine: 12,
    summary: "Use deterministic ordering",
    evidence: {
      snippet: "const b = 2; const a = 1;",
    },
    evidenceHash: HASH_C,
  };
}

function buildExecutionAudit() {
  return {
    schemaVersion: "execution-audit.v1",
    permissionProfileId: "read_only",
    worktreePath: null,
    commands: [
      {
        ordinal: 0,
        exitCode: 0,
        timedOut: false,
        stdoutSha256: HASH_A,
        stderrSha256: HASH_B,
      },
    ],
  };
}

function buildLensPlan() {
  return {
    schemaVersion: "lens-plan.v1",
    planOrdinal: 0,
    lensId: "consistency",
    subLensId: null,
    lensVersion: "v1",
    lensClass: "consistency",
    required: true,
    blockingPolicy: "rule_defined",
    providerBindingId: "binding-primary",
    permissionProfileId: "read_only",
    changedFiles: ["src/index.ts"],
    fullContextFiles: ["src/index.ts"],
    omittedFiles: [],
    scopeDigest: HASH_B,
    executionCommands: [
      {
        ordinal: 0,
        command: ["bun", "test"],
        cwdMode: "repo_root",
        purpose: "run deterministic test command",
      },
    ],
    maxInputTokens: 1000,
    maxOutputTokens: 500,
    maxCostUsd: null,
    overflowPolicy: "stop",
  };
}

function buildLensResult() {
  return {
    schemaVersion: "lens-result.v1",
    planOrdinal: 0,
    lensId: "consistency",
    subLensId: null,
    lensVersion: "v1",
    status: "completed",
    degraded: false,
    findings: [buildFinding()],
    evidenceSummary: ["Deterministic sort order verified"],
    usage: buildUsageMetrics(),
    errorCodes: [],
    warningCodes: [],
    executionAudit: null,
    adapterResponseHash: HASH_A,
  };
}

function buildFinalVerdict() {
  return {
    schemaVersion: "final-verdict.v1",
    status: "PASS",
    degraded: false,
    rationale: ["All required lenses completed"],
    requiredLensIds: ["consistency"],
    missingRequiredLensIds: [],
    failedRequiredLensIds: [],
    blockingFindings: [],
    errorCodes: [],
    aggregateUsage: buildUsageMetrics(),
  };
}

function buildSkillInput() {
  return {
    schemaVersion: "skill-input.v1",
    repoId: "acme/qa-skill",
    repoRoot: "/tmp/qa-skill",
    vcs: "git",
    baseRef: null,
    headRef: "HEAD",
    runMode: "strict",
    requestedLensIds: null,
    includeGlobs: null,
    excludeGlobs: null,
    explicitFiles: null,
    maxConcurrency: 4,
    allowExecutionLensClasses: [],
    permissionProfiles: [buildPermissionProfile()],
    defaultPermissionProfileId: "read_only",
    artifactRoot: ".qa-skill",
    runBudgetMaxTokens: 300000,
    runBudgetMaxCostUsd: 12,
    providerBindings: [buildProviderBinding()],
    configHash: HASH_A,
  };
}

function buildSkillManifest() {
  return {
    schemaVersion: "skill-manifest.v1",
    skillId: "qa-skill",
    skillVersion: "1.0.0",
    name: "qa-skill",
    summary: "Deterministic QA orchestrator skill manifest.",
    registryPath: "skill/registry.v1.json",
    defaultRunMode: "strict",
    supportedLensClasses: ["consistency", "style"],
    deterministicOrdering: {
      lenses: "lensId ASC",
      subLenses: "subLensId ASC",
    },
  };
}

function buildSkillRegistry() {
  return {
    schemaVersion: "skill-registry.v1",
    skillId: "qa-skill",
    skillVersion: "1.0.0",
    orderingRules: {
      lenses: "lensId ASC",
      subLenses: "subLensId ASC",
    },
    lenses: [
      {
        lensId: "consistency-core",
        lensVersion: "1.0.0",
        lensClass: "consistency",
        title: "Consistency Core",
        description: "Core consistency checks.",
        requiredByDefault: true,
        defaultPermissionProfileId: "read_only",
        trigger: {
          includeGlobs: ["**/*.ts"],
          excludeGlobs: [],
          pathPrefixes: ["scripts/"],
          symbolHints: ["deterministic"],
          minConfidence: 0.5,
        },
        subLenses: [
          {
            subLensId: "architecture-drift",
            title: "Architecture Drift",
            description: "Architecture checks.",
            required: true,
            blockingPolicy: "rule_defined",
            trigger: {
              includeGlobs: ["**/*.ts"],
              excludeGlobs: [],
              pathPrefixes: ["scripts/"],
              symbolHints: ["orchestrator"],
              minConfidence: 0.7,
            },
          },
          {
            subLensId: "style-guides",
            title: "Style Guides",
            description: "Style checks.",
            required: false,
            blockingPolicy: "mixed",
            trigger: {
              includeGlobs: ["**/*.ts"],
              excludeGlobs: [],
              pathPrefixes: ["scripts/"],
              symbolHints: ["style"],
              minConfidence: 0.4,
            },
          },
        ],
      },
    ],
  };
}

function buildQaRunConfig() {
  return {
    schemaVersion: "qa-run-config.v1",
    repoRoot: ".",
    runMode: "strict",
    includeGlobs: ["src/**/*.ts"],
    excludeGlobs: ["**/*.spec.ts"],
    explicitFiles: ["README.md"],
    maxConcurrency: 4,
    runBudgetMaxCostUsd: null,
    permissionProfiles: [buildPermissionProfile()],
    providerBindings: [buildProviderBinding()],
    defaultPermissionProfileId: "read_only",
  };
}

function buildSkillResult() {
  return {
    schemaVersion: "skill-result.v1",
    executionKey: HASH_A,
    normalizedInputHash: HASH_B,
    lensPlans: [buildLensPlan()],
    lensResults: [buildLensResult()],
    finalVerdict: buildFinalVerdict(),
  };
}

const VALID_PAYLOADS_BY_SCHEMA: Record<SchemaKey, unknown> = {
  "qa-run-config.v1": buildQaRunConfig(),
  "skill-manifest.v1": buildSkillManifest(),
  "skill-registry.v1": buildSkillRegistry(),
  "skill-input.v1": buildSkillInput(),
  "lens-plan.v1": buildLensPlan(),
  "lens-result.v1": buildLensResult(),
  "final-verdict.v1": buildFinalVerdict(),
  "skill-result.v1": buildSkillResult(),
  "execution-audit.v1": buildExecutionAudit(),
};

test("schema registry contains the complete schema set including skill contracts", () => {
  expect(getRegisteredSchemaKeys()).toEqual([
    "qa-run-config.v1",
    "skill-manifest.v1",
    "skill-registry.v1",
    "skill-input.v1",
    "lens-plan.v1",
    "lens-result.v1",
    "final-verdict.v1",
    "skill-result.v1",
    "execution-audit.v1",
  ]);
});

test("validateSchema accepts valid exemplar payloads for each schema", () => {
  for (const [schemaKey, payload] of Object.entries(VALID_PAYLOADS_BY_SCHEMA) as [
    SchemaKey,
    unknown,
  ][]) {
    const result = validateSchema(schemaKey, payload);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  }
});

test("assertSchema emits deterministic validation errors for invalid payloads", () => {
  const invalidConfig = {
    schemaVersion: "qa-run-config.v1",
    maxConcurrency: 0,
    unknownKey: true,
  };

  const first = validateSchema("qa-run-config.v1", invalidConfig);
  const second = validateSchema("qa-run-config.v1", invalidConfig);
  expect(first).toEqual(second);
  expect(first.valid).toBe(false);

  const captureError = (): CliError => {
    try {
      assertSchema("qa-run-config.v1", invalidConfig, "CONFIG_VALIDATION_ERROR");
      throw new Error("Expected assertSchema to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      return error as CliError;
    }
  };

  const firstError = captureError();
  const secondError = captureError();

  expect(firstError.code).toBe("CONFIG_VALIDATION_ERROR");
  expect(secondError.code).toBe("CONFIG_VALIDATION_ERROR");
  expect(firstError.message).toBe(secondError.message);
  expect(firstError.message).toContain("qa-run-config.v1");
});

test("validateSchema rejects non-integer and negative usage token counts", () => {
  const invalidLensResult = {
    ...buildLensResult(),
    usage: {
      ...buildUsageMetrics(),
      inputTokens: -1,
      outputTokens: 1.5,
      totalTokens: -2,
    },
  };

  const result = validateSchema("lens-result.v1", invalidLensResult);
  expect(result.valid).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);

  const paths = result.errors.map((error) => error.instancePath);
  expect(paths).toContain("/usage/inputTokens");
  expect(paths).toContain("/usage/outputTokens");
  expect(paths).toContain("/usage/totalTokens");
});

test("validateSchema rejects invalid targeting entries with deterministic ordering", () => {
  const sparseExplicitFiles = new Array(1) as string[];

  const invalidConfig = {
    schemaVersion: "qa-run-config.v1",
    includeGlobs: ["", "src/**/*.ts"],
    excludeGlobs: ["**/*.tmp", 1],
    explicitFiles: sparseExplicitFiles,
  };

  const first = validateSchema("qa-run-config.v1", invalidConfig);
  const second = validateSchema("qa-run-config.v1", invalidConfig);

  expect(first).toEqual(second);
  expect(first.valid).toBe(false);

  expect(first.errors).toEqual([...first.errors].sort(compareValidationErrors));

  const paths = first.errors.map((error) => error.instancePath);
  expect(paths).toContain("/includeGlobs/0");
  expect(paths).toContain("/excludeGlobs/1");
  expect(paths).toContain("/explicitFiles/0");
});

function loadJsonFixture(relativePath: string): unknown {
  const fixturePath = new URL(relativePath, import.meta.url);
  const raw = readFileSync(fixturePath, "utf8");
  return JSON.parse(raw) as unknown;
}

test("skill manifest and registry fixtures validate against schema contracts", () => {
  const manifest = loadJsonFixture("../../../skill/manifest.v1.json");
  const registry = loadJsonFixture("../../../skill/registry.v1.json");

  expect(validateSchema("skill-manifest.v1", manifest)).toEqual({
    valid: true,
    errors: [],
  });
  expect(validateSchema("skill-registry.v1", registry)).toEqual({
    valid: true,
    errors: [],
  });
});

test("skill registry fixture keeps deterministic lens/sub-lens ordering", () => {
  const registry = loadJsonFixture("../../../skill/registry.v1.json") as {
    lenses: Array<{ lensId: string; subLenses: Array<{ subLensId: string }> }>;
  };

  const lensIds = registry.lenses.map((lens) => lens.lensId);
  expect(lensIds).toEqual([...lensIds].sort());

  for (const lens of registry.lenses) {
    const subLensIds = lens.subLenses.map((subLens) => subLens.subLensId);
    expect(subLensIds).toEqual([...subLensIds].sort());
  }
});
