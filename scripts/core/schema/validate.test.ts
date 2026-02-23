import { expect, test } from "bun:test";

import { CliError } from "../errors";
import {
  getRegisteredSchemaKeys,
  type SchemaKey,
} from "./registry";
import { assertSchema, validateSchema } from "./validate";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

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

function buildQaRunConfig() {
  return {
    schemaVersion: "qa-run-config.v1",
    repoRoot: ".",
    runMode: "strict",
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
  "skill-input.v1": buildSkillInput(),
  "lens-plan.v1": buildLensPlan(),
  "lens-result.v1": buildLensResult(),
  "final-verdict.v1": buildFinalVerdict(),
  "skill-result.v1": buildSkillResult(),
  "execution-audit.v1": buildExecutionAudit(),
};

test("schema registry contains the complete BEL-201 schema set", () => {
  expect(getRegisteredSchemaKeys()).toEqual([
    "qa-run-config.v1",
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
