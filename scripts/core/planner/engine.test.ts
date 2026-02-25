import { expect, test } from "bun:test";

import type { LensPlan } from "../../contracts/artifacts";
import type { SkillInput } from "../../contracts/skill-input";
import type { ChangeSurfaceResult } from "../git/change-surface-types";
import type { ContextBoundsResult } from "../context/types";
import { stableStringify } from "../../utils/canonical-json";
import { CliError } from "../errors";
import { validateSchema } from "../schema/validate";
import type {
  LensDefinition,
  LensSubLensDefinition,
  LensTriggerMetadata,
} from "../../lenses/contracts";
import type {
  LoadedLensRegistry,
  SkillManifestV1,
  SkillRegistryV1,
} from "../../lenses/loader";
import { buildLensPlans, sortLensPlansForQueue } from "./engine";

const HASH = "a".repeat(64);

function buildTrigger(overrides: Partial<LensTriggerMetadata> = {}): LensTriggerMetadata {
  return {
    includeGlobs: ["**/*.ts"],
    excludeGlobs: [],
    pathPrefixes: ["src/"],
    symbolHints: ["import"],
    minConfidence: 0.5,
    ...overrides,
  };
}

function buildSubLens(
  subLensId: string,
  overrides: Partial<LensSubLensDefinition> = {},
): LensSubLensDefinition {
  return {
    subLensId,
    title: subLensId,
    description: `${subLensId} checks`,
    required: false,
    blockingPolicy: "mixed",
    trigger: buildTrigger(),
    ...overrides,
  };
}

function buildLens(
  lensId: string,
  lensClass: LensDefinition["lensClass"],
  subLenses: LensSubLensDefinition[],
  overrides: Partial<LensDefinition> = {},
): LensDefinition {
  return {
    lensId,
    lensVersion: "1.0.0",
    lensClass,
    title: lensId,
    description: `${lensId} checks`,
    requiredByDefault: false,
    defaultPermissionProfileId: "read_only",
    trigger: buildTrigger(),
    subLenses,
    ...overrides,
  };
}

function buildRegistry(lenses: LensDefinition[]): LoadedLensRegistry {
  const manifest: SkillManifestV1 = {
    schemaVersion: "skill-manifest.v1",
    skillId: "qa-skill",
    skillVersion: "1.0.0",
    name: "qa-skill",
    summary: "Deterministic planner tests",
    registryPath: "skill/registry.v1.json",
    defaultRunMode: "strict",
    supportedLensClasses: ["consistency", "style", "security", "architecture", "performance"],
    deterministicOrdering: {
      lenses: "lensId ASC",
      subLenses: "subLensId ASC",
    },
  };

  const registry: SkillRegistryV1 = {
    schemaVersion: "skill-registry.v1",
    skillId: "qa-skill",
    skillVersion: "1.0.0",
    orderingRules: {
      lenses: "lensId ASC",
      subLenses: "subLensId ASC",
    },
    lenses: [...lenses],
  };

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
    manifest,
    registry,
    lenses: [...lenses],
    lensesById,
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
    providerBindings: [
      {
        bindingId: "binding-z",
        adapterId: "openai-codex",
        adapterVersion: "2026-01-01",
        modelId: "o4-mini",
        temperature: 0,
        topP: 1,
        maxTokens: 8000,
        seed: null,
        timeoutMs: 60000,
        retryMax: 2,
        retryBackoffMs: [500, 1500],
      },
      {
        bindingId: "binding-a",
        adapterId: "openai-codex",
        adapterVersion: "2026-01-01",
        modelId: "o4-mini",
        temperature: 0,
        topP: 1,
        maxTokens: 12000,
        seed: null,
        timeoutMs: 60000,
        retryMax: 2,
        retryBackoffMs: [500, 1500],
      },
    ],
    configHash: HASH,
    ...overrides,
  };
}

function buildChangeSurface(
  files: Array<{ filePath: string; symbols?: string[] }>,
): ChangeSurfaceResult {
  const normalizedFiles = [...files].map((file) => ({
    filePath: file.filePath,
    bucket: "source" as const,
    scope: "app" as const,
    language: "typescript" as const,
    hunkCount: 1,
    changedLines: 1,
    symbols: [...new Set((file.symbols ?? []).map((symbol) => symbol.toLowerCase()))].sort(),
  }));

  return {
    files: normalizedFiles,
    rankedFilePaths: normalizedFiles.map((file) => file.filePath).sort(),
    bucketCounts: [],
    scopeCounts: [],
    languageCounts: [],
  };
}

function buildContextBounds(
  selectedFiles: string[],
  omittedFiles: string[] = [],
): ContextBoundsResult {
  const selected = [...selectedFiles];
  const omitted = [...omittedFiles];

  return {
    limits: {
      maxDiffFiles: 1000,
      maxDiffHunks: 1000,
      maxContextFiles: 1000,
      maxContextHunks: 1000,
      maxContextChangedLines: 10000,
    },
    rankedFiles: [...new Set([...selected, ...omitted])].sort(),
    selectedFiles: selected,
    selectedHunks: [],
    omittedFiles: omitted,
    omittedHunks: [],
    warningCodes: omitted.length > 0 ? ["CONTEXT_BOUND_EXCEEDED"] : [],
    errorCodes: [],
    totals: {
      totalFiles: selected.length + omitted.length,
      totalHunks: 0,
      totalChangedLines: 0,
      selectedFiles: selected.length,
      selectedHunks: 0,
      selectedChangedLines: 0,
      omittedFiles: omitted.length,
      omittedHunks: 0,
    },
  };
}

function buildInputFixture(overrides: Partial<BuildLensPlansFixture> = {}): BuildLensPlansFixture {
  const registry = buildRegistry([
    buildLens("consistency-core", "consistency", [
      buildSubLens("architecture-drift", {
        required: true,
        blockingPolicy: "rule_defined",
        trigger: buildTrigger({
          includeGlobs: ["src/**"],
          pathPrefixes: ["src/"],
          symbolHints: ["orchestrator"],
          minConfidence: 0.7,
        }),
      }),
      buildSubLens("style-guides", {
        trigger: buildTrigger({
          includeGlobs: ["**/*.ts"],
          pathPrefixes: ["src/"],
          symbolHints: ["import"],
          minConfidence: 0.2,
        }),
      }),
    ], {
      requiredByDefault: true,
    }),
    buildLens("style-core", "style", [
      buildSubLens("css-naming", {
        blockingPolicy: "severity_threshold",
        trigger: buildTrigger({
          includeGlobs: ["**/*.css"],
          pathPrefixes: ["src/"],
          symbolHints: ["classname"],
          minConfidence: 0.4,
        }),
      }),
      buildSubLens("typescript-formatting", {
        trigger: buildTrigger({
          includeGlobs: ["**/*.ts"],
          pathPrefixes: ["src/"],
          symbolHints: ["import"],
          minConfidence: 0.2,
        }),
      }),
    ], {
      defaultPermissionProfileId: "exec_sandboxed",
    }),
  ]);

  return {
    skillInput: buildSkillInput(),
    registry,
    selectedLensIds: ["consistency-core", "style-core"],
    changeSurface: buildChangeSurface([
      { filePath: "src/app.ts", symbols: ["import", "orchestrator"] },
      { filePath: "src/styles.css", symbols: ["className"] },
    ]),
    contextBounds: buildContextBounds(["src/app.ts", "src/styles.css"], ["src/omitted.ts"]),
    ...overrides,
  };
}

interface BuildLensPlansFixture {
  skillInput: SkillInput;
  registry: LoadedLensRegistry;
  selectedLensIds: string[];
  changeSurface: ChangeSurfaceResult;
  contextBounds: ContextBoundsResult;
}

function buildPlan(overrides: Partial<LensPlan>): LensPlan {
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
    scopeDigest: "0".repeat(64),
    executionCommands: [],
    maxInputTokens: 1000,
    maxOutputTokens: 1000,
    maxCostUsd: null,
    overflowPolicy: "skip",
    ...overrides,
  };
}

test("sortLensPlansForQueue applies deterministic queue precedence", () => {
  const sorted = sortLensPlansForQueue([
    buildPlan({
      required: true,
      lensClass: "consistency",
      lensId: "lens-a",
      subLensId: "sub-a",
      scopeDigest: "d".repeat(64),
    }),
    buildPlan({
      required: false,
      lensClass: "style",
      lensId: "lens-a",
      subLensId: "sub-a",
      scopeDigest: "z".repeat(64),
    }),
    buildPlan({
      required: true,
      lensClass: "consistency",
      lensId: "lens-b",
      subLensId: "sub-a",
      scopeDigest: "b".repeat(64),
    }),
    buildPlan({
      required: true,
      lensClass: "consistency",
      lensId: "lens-a",
      subLensId: "sub-b",
      scopeDigest: "a".repeat(64),
    }),
    buildPlan({
      required: true,
      lensClass: "style",
      lensId: "lens-a",
      subLensId: "sub-a",
      scopeDigest: "a".repeat(64),
    }),
    buildPlan({
      required: true,
      lensClass: "consistency",
      lensId: "lens-a",
      subLensId: "sub-a",
      scopeDigest: "a".repeat(64),
    }),
  ]);

  expect(
    sorted.map((plan) => `${plan.lensClass}:${plan.lensId}:${plan.subLensId}:${plan.scopeDigest[0]}`),
  ).toEqual([
    "consistency:lens-a:sub-a:a",
    "consistency:lens-a:sub-a:d",
    "consistency:lens-a:sub-b:a",
    "consistency:lens-b:sub-a:b",
    "style:lens-a:sub-a:a",
    "style:lens-a:sub-a:z",
  ]);
  expect(sorted.map((plan) => plan.planOrdinal)).toEqual([0, 1, 2, 3, 4, 5]);
});

test("buildLensPlans is byte-identical across 100 identical runs", () => {
  const fixture = buildInputFixture();
  const first = buildLensPlans(fixture);
  const expected = stableStringify(first.lensPlans);

  for (let index = 0; index < 100; index += 1) {
    const next = buildLensPlans(fixture);
    expect(stableStringify(next.lensPlans)).toBe(expected);
    expect(next.warningCodes).toEqual(first.warningCodes);
    expect(stableStringify(next.diagnostics)).toBe(stableStringify(first.diagnostics));
  }
});

test("buildLensPlans remains deterministic when input ordering is shuffled", () => {
  const fixture = buildInputFixture();
  const baseline = buildLensPlans(fixture);

  const shuffled = buildLensPlans({
    ...fixture,
    selectedLensIds: [...fixture.selectedLensIds].reverse(),
    changeSurface: {
      ...fixture.changeSurface,
      files: [...fixture.changeSurface.files].reverse(),
      rankedFilePaths: [...fixture.changeSurface.rankedFilePaths].reverse(),
    },
    contextBounds: {
      ...fixture.contextBounds,
      selectedFiles: [...fixture.contextBounds.selectedFiles].reverse(),
      omittedFiles: [...fixture.contextBounds.omittedFiles].reverse(),
    },
  });

  expect(stableStringify(shuffled.lensPlans)).toBe(stableStringify(baseline.lensPlans));
  expect(stableStringify(shuffled.diagnostics)).toBe(stableStringify(baseline.diagnostics));
  expect(shuffled.warningCodes).toEqual(baseline.warningCodes);
});

test("buildLensPlans selects only sub-lenses meeting deterministic confidence threshold", () => {
  const registry = buildRegistry([
    buildLens("heuristic-core", "consistency", [
      buildSubLens("fail-sub", {
        trigger: buildTrigger({
          includeGlobs: ["**/*.md"],
          pathPrefixes: ["docs/"],
          symbolHints: ["heading"],
          minConfidence: 0.9,
        }),
      }),
      buildSubLens("pass-sub", {
        required: true,
        trigger: buildTrigger({
          includeGlobs: ["**/*.ts"],
          pathPrefixes: ["src/"],
          symbolHints: ["import"],
          minConfidence: 0.7,
        }),
      }),
    ]),
  ]);

  const result = buildLensPlans({
    skillInput: buildSkillInput(),
    registry,
    selectedLensIds: ["heuristic-core"],
    changeSurface: buildChangeSurface([{ filePath: "src/app.ts", symbols: ["import"] }]),
    contextBounds: buildContextBounds(["src/app.ts"]),
  });

  expect(result.warningCodes).toEqual([]);
  expect(result.lensPlans.map((plan) => plan.subLensId)).toEqual(["pass-sub"]);
  expect(result.diagnostics.map((diagnostic) => `${diagnostic.subLensId}:${diagnostic.selected}`)).toEqual([
    "fail-sub:false",
    "pass-sub:true",
  ]);
});

test("buildLensPlans supports prefix/**/*.ext include globs", () => {
  const registry = buildRegistry([
    buildLens("glob-core", "consistency", [
      buildSubLens("prefix-ext", {
        trigger: buildTrigger({
          includeGlobs: ["src/**/*.ts"],
          pathPrefixes: [],
          symbolHints: [],
          minConfidence: 0.6,
        }),
      }),
    ]),
  ]);

  const result = buildLensPlans({
    skillInput: buildSkillInput(),
    registry,
    selectedLensIds: ["glob-core"],
    changeSurface: buildChangeSurface([{ filePath: "src/features/app.ts", symbols: [] }]),
    contextBounds: buildContextBounds(["src/features/app.ts"]),
  });

  expect(result.warningCodes).toEqual([]);
  expect(result.lensPlans.map((plan) => plan.subLensId)).toEqual(["prefix-ext"]);
  expect(result.lensPlans[0]?.changedFiles).toEqual(["src/features/app.ts"]);
});

test("buildLensPlans uses broad deterministic fallback when no sub-lens meets confidence", () => {
  const registry = buildRegistry([
    buildLens("fallback-core", "style", [
      buildSubLens("sub-a", {
        trigger: buildTrigger({
          includeGlobs: ["**/*.ts"],
          minConfidence: 0.8,
        }),
      }),
      buildSubLens("sub-b", {
        trigger: buildTrigger({
          includeGlobs: ["**/*.css"],
          minConfidence: 0.8,
        }),
      }),
    ]),
  ]);

  const result = buildLensPlans({
    skillInput: buildSkillInput(),
    registry,
    selectedLensIds: ["fallback-core"],
    changeSurface: buildChangeSurface([]),
    contextBounds: buildContextBounds([]),
  });

  expect(result.warningCodes).toEqual(["PLAN_CONFIDENCE_LOW_BROAD_SCAN"]);
  expect(result.lensPlans.map((plan) => plan.subLensId)).toEqual(["sub-a", "sub-b"]);
  expect(result.lensPlans.every((plan) => plan.changedFiles.length === 0)).toBe(true);
  expect(result.diagnostics.every((diagnostic) => diagnostic.broadFallback)).toBe(true);
});

test("buildLensPlans rejects unsupported wildcard glob patterns deterministically", () => {
  const registry = buildRegistry([
    buildLens("unsupported-glob-core", "style", [
      buildSubLens("bad-pattern", {
        trigger: buildTrigger({
          includeGlobs: ["src/**/foo/*.ts"],
          minConfidence: 0.2,
        }),
      }),
    ]),
  ]);

  const fixture = {
    skillInput: buildSkillInput(),
    registry,
    selectedLensIds: ["unsupported-glob-core"],
    changeSurface: buildChangeSurface([{ filePath: "src/foo.ts", symbols: [] }]),
    contextBounds: buildContextBounds(["src/foo.ts"]),
  };

  expect(() => buildLensPlans(fixture)).toThrow(CliError);

  try {
    buildLensPlans(fixture);
    throw new Error("Expected buildLensPlans to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    const cliError = error as CliError;
    expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(cliError.message).toContain("unsupported wildcard glob");
    expect(cliError.message).toContain("src/**/foo/*.ts");
  }
});

test("buildLensPlans rejects non-asterisk wildcard glob patterns deterministically", () => {
  const registry = buildRegistry([
    buildLens("unsupported-wildcard-core", "style", [
      buildSubLens("bad-pattern", {
        trigger: buildTrigger({
          includeGlobs: ["src/?.ts", "foo/[ab].ts"],
          minConfidence: 0.2,
        }),
      }),
    ]),
  ]);

  const fixture = {
    skillInput: buildSkillInput(),
    registry,
    selectedLensIds: ["unsupported-wildcard-core"],
    changeSurface: buildChangeSurface([{ filePath: "src/a.ts", symbols: [] }]),
    contextBounds: buildContextBounds(["src/a.ts"]),
  };

  expect(() => buildLensPlans(fixture)).toThrow(CliError);

  try {
    buildLensPlans(fixture);
    throw new Error("Expected buildLensPlans to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    const cliError = error as CliError;
    expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(cliError.message).toContain("unsupported wildcard glob");
    expect(cliError.message).toContain("src/?.ts");
    expect(cliError.message).toContain("foo/[ab].ts");
  }
});

test("buildLensPlans gates prefix scoring behind include/exclude matched files", () => {
  const registry = buildRegistry([
    buildLens("prefix-gate-core", "style", [
      buildSubLens("sub-a", {
        trigger: buildTrigger({
          includeGlobs: ["**/*.ts"],
          excludeGlobs: ["src/**"],
          pathPrefixes: ["src/"],
          minConfidence: 0.2,
        }),
      }),
    ]),
  ]);

  const result = buildLensPlans({
    skillInput: buildSkillInput(),
    registry,
    selectedLensIds: ["prefix-gate-core"],
    changeSurface: buildChangeSurface([{ filePath: "src/app.ts", symbols: [] }]),
    contextBounds: buildContextBounds(["src/app.ts"]),
  });

  expect(result.warningCodes).toEqual(["PLAN_CONFIDENCE_LOW_BROAD_SCAN"]);
  expect(result.lensPlans.map((plan) => plan.subLensId)).toEqual(["sub-a"]);
  expect(result.lensPlans[0]?.changedFiles).toEqual(["src/app.ts"]);
  expect(result.diagnostics[0]?.prefixSignal).toBe(0);
  expect(result.diagnostics[0]?.score).toBe(0);
  expect(result.diagnostics[0]?.broadFallback).toBe(true);
});

test("buildLensPlans rejects empty provider bindings deterministically", () => {
  const fixture = buildInputFixture({
    skillInput: buildSkillInput({
      providerBindings: [],
    }),
  });

  expect(() => buildLensPlans(fixture)).toThrow(CliError);

  try {
    buildLensPlans(fixture);
    throw new Error("Expected buildLensPlans to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    const cliError = error as CliError;
    expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(cliError.message).toContain("providerBindings must contain at least one binding");
  }
});

test("buildLensPlans rejects selected lenses that define no sub-lenses", () => {
  const fixture = buildInputFixture({
    registry: buildRegistry([buildLens("empty-lens", "consistency", [])]),
    selectedLensIds: ["empty-lens"],
  });

  expect(() => buildLensPlans(fixture)).toThrow(CliError);

  try {
    buildLensPlans(fixture);
    throw new Error("Expected buildLensPlans to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    const cliError = error as CliError;
    expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(cliError.message).toContain("must define at least one subLens");
  }
});

test("buildLensPlans picks a deterministic primary provider binding under tied identifiers", () => {
  const bindingLarge = {
    bindingId: "binding-tie",
    adapterId: "openai-codex" as const,
    adapterVersion: "2026-01-01",
    modelId: "o4-mini",
    temperature: 0 as const,
    topP: 1 as const,
    maxTokens: 9000,
    seed: null,
    timeoutMs: 60000,
    retryMax: 2 as const,
    retryBackoffMs: [500, 1500] as const,
  };
  const bindingSmall = {
    ...bindingLarge,
    maxTokens: 4000,
  };

  const forward = buildLensPlans(
    buildInputFixture({
      skillInput: buildSkillInput({
        providerBindings: [bindingLarge, bindingSmall],
      }),
    }),
  );
  const reversed = buildLensPlans(
    buildInputFixture({
      skillInput: buildSkillInput({
        providerBindings: [bindingSmall, bindingLarge],
      }),
    }),
  );

  expect(stableStringify(forward.lensPlans)).toBe(stableStringify(reversed.lensPlans));
  expect(forward.lensPlans.every((plan) => plan.maxInputTokens === 4000)).toBe(true);
  expect(forward.lensPlans.every((plan) => plan.maxOutputTokens === 4000)).toBe(true);
});

test("buildLensPlans falls back to default permission profile when lens default is missing", () => {
  const result = buildLensPlans(buildInputFixture());
  expect(result.lensPlans.every((plan) => plan.permissionProfileId === "read_only")).toBe(
    true,
  );
});

test("buildLensPlans emits schema-valid lens plan payloads", () => {
  const result = buildLensPlans(buildInputFixture());

  for (const plan of result.lensPlans) {
    const validation = validateSchema("lens-plan.v1", plan);
    expect(validation.valid).toBe(true);
  }
});

test("buildLensPlans preserves deterministic omitted files when selected files are empty", () => {
  const result = buildLensPlans(
    buildInputFixture({
      contextBounds: buildContextBounds([], ["src/alpha.ts", "src/beta.ts"]),
      changeSurface: buildChangeSurface([]),
    }),
  );

  expect(result.warningCodes).toEqual(["PLAN_CONFIDENCE_LOW_BROAD_SCAN"]);
  expect(result.lensPlans.length).toBeGreaterThan(0);
  expect(result.lensPlans.every((plan) => plan.changedFiles.length === 0)).toBe(true);
  expect(result.lensPlans.every((plan) => plan.omittedFiles.join(",") === "src/alpha.ts,src/beta.ts")).toBe(
    true,
  );
});
