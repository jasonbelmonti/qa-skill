import { expect, test } from "bun:test";

import type { LensPlan } from "../../contracts/artifacts";
import type {
  ProviderBinding,
  SkillInput,
} from "../../contracts/skill-input";
import { stableStringify } from "../../utils/canonical-json";
import { CliError } from "../errors";
import {
  buildDispatcherPreflight,
  normalizeLensPlansForDispatch,
  resolvePrimaryProviderBinding,
} from "./preflight";

const HASH = "a".repeat(64);

function buildProviderBinding(
  bindingId: string,
  overrides: Partial<ProviderBinding> = {},
): ProviderBinding {
  return {
    bindingId,
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
    ...overrides,
  };
}

function buildSkillInput(overrides: Partial<SkillInput> = {}): SkillInput {
  return {
    schemaVersion: "skill-input.v1",
    repoId: "acme/qa-skill",
    repoRoot: "/repo",
    vcs: "git",
    baseRef: "origin/main",
    headRef: "HEAD",
    runMode: "strict",
    requestedLensIds: null,
    maxConcurrency: 4,
    allowExecutionLensClasses: [],
    permissionProfiles: [
      {
        profileId: "read_only",
        readOnly: true,
        allowNetwork: false,
        worktreeMode: "none",
        allowedCommandPrefixes: [],
        maxCommandsPerPlan: 0,
        commandTimeoutMs: 0,
        maxStdoutBytes: 0,
        maxStderrBytes: 0,
      },
    ],
    defaultPermissionProfileId: "read_only",
    artifactRoot: ".qa-skill",
    runBudgetMaxTokens: 300000,
    runBudgetMaxCostUsd: 12,
    providerBindings: [buildProviderBinding("binding-z"), buildProviderBinding("binding-a")],
    configHash: HASH,
    ...overrides,
  };
}

function buildPlan(overrides: Partial<LensPlan> = {}): LensPlan {
  return {
    schemaVersion: "lens-plan.v1",
    planOrdinal: 0,
    lensId: "lens-a",
    subLensId: "sub-a",
    lensVersion: "1.0.0",
    lensClass: "style",
    required: false,
    blockingPolicy: "mixed",
    providerBindingId: "binding-a",
    permissionProfileId: "read_only",
    changedFiles: ["src/a.ts"],
    fullContextFiles: [],
    omittedFiles: [],
    scopeDigest: HASH,
    executionCommands: [],
    maxInputTokens: 1000,
    maxOutputTokens: 1000,
    maxCostUsd: null,
    overflowPolicy: "skip",
    ...overrides,
  };
}

test("resolvePrimaryProviderBinding picks deterministic lexical binding", () => {
  const forward = resolvePrimaryProviderBinding(
    buildSkillInput({
      providerBindings: [buildProviderBinding("binding-z"), buildProviderBinding("binding-a")],
    }),
  );
  const reversed = resolvePrimaryProviderBinding(
    buildSkillInput({
      providerBindings: [buildProviderBinding("binding-a"), buildProviderBinding("binding-z")],
    }),
  );

  expect(forward.bindingId).toBe("binding-a");
  expect(stableStringify(forward)).toBe(stableStringify(reversed));
});

test("buildDispatcherPreflight rejects empty provider bindings deterministically", () => {
  expect(() =>
    buildDispatcherPreflight({
      skillInput: buildSkillInput({
        providerBindings: [],
      }),
      lensPlans: [],
    }),
  ).toThrow(CliError);

  try {
    buildDispatcherPreflight({
      skillInput: buildSkillInput({
        providerBindings: [],
      }),
      lensPlans: [],
    });
    throw new Error("Expected buildDispatcherPreflight to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    const cliError = error as CliError;
    expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(cliError.message).toBe(
      "Dispatcher preflight failed: #1 path=skillInput.providerBindings message=must contain at least one binding",
    );
  }
});

test("normalizeLensPlansForDispatch stabilizes plan and command ordering", () => {
  const normalized = normalizeLensPlansForDispatch([
    buildPlan({
      planOrdinal: 1,
      lensId: "lens-b",
      subLensId: "sub-z",
      changedFiles: ["src/z.ts", "src/a.ts", "src/a.ts"],
      fullContextFiles: ["src/d.ts", "src/b.ts", "src/b.ts"],
      omittedFiles: ["src/zz.ts", "src/aa.ts", "src/aa.ts"],
      executionCommands: [
        {
          ordinal: 3,
          command: ["bun", "test"],
          cwdMode: "repo_root",
          purpose: "third",
        },
        {
          ordinal: 1,
          command: ["bun", "lint"],
          cwdMode: "repo_root",
          purpose: "first",
        },
      ],
    }),
    buildPlan({
      planOrdinal: 0,
      lensId: "lens-a",
      subLensId: null,
    }),
  ]);

  expect(normalized.map((plan) => `${plan.planOrdinal}:${plan.lensId}:${plan.subLensId}`)).toEqual(
    ["0:lens-a:null", "1:lens-b:sub-z"],
  );

  expect(normalized[1]?.changedFiles).toEqual(["src/a.ts", "src/z.ts"]);
  expect(normalized[1]?.fullContextFiles).toEqual(["src/b.ts", "src/d.ts"]);
  expect(normalized[1]?.omittedFiles).toEqual(["src/aa.ts", "src/zz.ts"]);
  expect(normalized[1]?.executionCommands.map((command) => command.ordinal)).toEqual([1, 3]);
});

test("buildDispatcherPreflight output is deterministic under shuffled inputs", () => {
  const forward = buildDispatcherPreflight({
    skillInput: buildSkillInput({
      providerBindings: [
        buildProviderBinding("binding-z", { maxTokens: 6000 }),
        buildProviderBinding("binding-a", { maxTokens: 5000 }),
      ],
    }),
    lensPlans: [
      buildPlan({ planOrdinal: 2, lensId: "lens-c", subLensId: "sub-b" }),
      buildPlan({ planOrdinal: 0, lensId: "lens-a", subLensId: "sub-a" }),
      buildPlan({ planOrdinal: 1, lensId: "lens-b", subLensId: null }),
    ],
  });

  const shuffled = buildDispatcherPreflight({
    skillInput: buildSkillInput({
      providerBindings: [
        buildProviderBinding("binding-a", { maxTokens: 5000 }),
        buildProviderBinding("binding-z", { maxTokens: 6000 }),
      ],
    }),
    lensPlans: [
      buildPlan({ planOrdinal: 1, lensId: "lens-b", subLensId: null }),
      buildPlan({ planOrdinal: 2, lensId: "lens-c", subLensId: "sub-b" }),
      buildPlan({ planOrdinal: 0, lensId: "lens-a", subLensId: "sub-a" }),
    ],
  });

  expect(stableStringify(forward)).toBe(stableStringify(shuffled));
  expect(forward.tasks.map((task) => task.queueOrdinal)).toEqual([0, 1, 2]);
  expect(forward.tasks.map((task) => task.plan.planOrdinal)).toEqual([0, 1, 2]);
  expect(forward.primaryProviderBinding.bindingId).toBe("binding-a");
});

test("buildDispatcherPreflight rejects duplicate plan ordinals deterministically", () => {
  expect(() =>
    buildDispatcherPreflight({
      skillInput: buildSkillInput(),
      lensPlans: [
        buildPlan({ planOrdinal: 0, lensId: "lens-a" }),
        buildPlan({ planOrdinal: 0, lensId: "lens-b" }),
      ],
    }),
  ).toThrow(CliError);

  try {
    buildDispatcherPreflight({
      skillInput: buildSkillInput(),
      lensPlans: [
        buildPlan({ planOrdinal: 0, lensId: "lens-a" }),
        buildPlan({ planOrdinal: 0, lensId: "lens-b" }),
      ],
    });
    throw new Error("Expected buildDispatcherPreflight to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    const cliError = error as CliError;
    expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(cliError.message).toContain("duplicate planOrdinal (0)");
    expect(cliError.message).toContain("lensPlans[1].planOrdinal");
  }
});
