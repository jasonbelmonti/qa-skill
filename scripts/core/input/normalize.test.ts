import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { QaRunConfigV1 } from "../../contracts/config";
import { CliError } from "../errors";
import type { BaseRefResolutionResult } from "../git/types";
import { DEFAULT_READ_ONLY_PERMISSION_PROFILE } from "./constants";
import {
  deriveRepoIdFromRemoteUrl,
  normalizeConfigForRun,
  normalizeConfigToSkillInput,
} from "./normalize";
import type { NormalizeOptions } from "./types";

async function withTempDir<T>(fn: (tempDir: string) => Promise<T>): Promise<T> {
  const testDir = await mkdtemp(join(tmpdir(), "qa-skill-normalize-"));
  try {
    return await fn(testDir);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}

function createNormalizeOptions(
  cwd: string,
  overrides: Partial<NormalizeOptions> = {},
): NormalizeOptions {
  return {
    cwd,
    getOriginRemoteUrl: async () => "https://github.com/acme/qa-skill.git",
    resolveBaseRef: async (
      _repoRoot: string,
      configuredBaseRef: string | null | undefined,
    ): Promise<BaseRefResolutionResult> => ({
      requestedBaseRef: configuredBaseRef ?? null,
      resolvedBaseRef: configuredBaseRef ?? "origin/main",
      warningCodes: [],
    }),
    ...overrides,
  };
}

test("deriveRepoIdFromRemoteUrl handles https remotes", () => {
  expect(
    deriveRepoIdFromRemoteUrl(
      "https://github.com/jasonbelmonti/qa-skill.git",
      "/tmp/qa-skill",
    ),
  ).toBe("jasonbelmonti/qa-skill");
});

test("deriveRepoIdFromRemoteUrl handles ssh remotes", () => {
  expect(
    deriveRepoIdFromRemoteUrl(
      "git@github.com:jasonbelmonti/qa-skill.git",
      "/tmp/qa-skill",
    ),
  ).toBe("jasonbelmonti/qa-skill");
});

test("deriveRepoIdFromRemoteUrl normalizes .git/ suffix for https remotes", () => {
  expect(
    deriveRepoIdFromRemoteUrl(
      "https://github.com/jasonbelmonti/qa-skill.git/",
      "/tmp/qa-skill",
    ),
  ).toBe("jasonbelmonti/qa-skill");
});

test("deriveRepoIdFromRemoteUrl normalizes .git/ suffix for ssh remotes", () => {
  expect(
    deriveRepoIdFromRemoteUrl(
      "git@github.com:jasonbelmonti/qa-skill.git/",
      "/tmp/qa-skill",
    ),
  ).toBe("jasonbelmonti/qa-skill");
});

test("deriveRepoIdFromRemoteUrl falls back to repo directory when remote is unavailable", () => {
  expect(deriveRepoIdFromRemoteUrl(null, "/tmp/qa-skill")).toBe("qa-skill");
});

test("deriveRepoIdFromRemoteUrl falls back to deterministic value for posix root", () => {
  expect(deriveRepoIdFromRemoteUrl(null, "/")).toBe("repo-root");
});

test("deriveRepoIdFromRemoteUrl falls back to deterministic value for windows drive root", () => {
  expect(deriveRepoIdFromRemoteUrl(null, "C:\\")).toBe("C");
});

test("normalizeConfigToSkillInput applies deterministic defaults", async () => {
  await withTempDir(async (testDir) => {
    const expectedRepoRoot = await realpath(testDir);
    const normalized = await normalizeConfigToSkillInput(
      {},
      createNormalizeOptions(testDir),
    );

    expect(normalized).toMatchObject({
      schemaVersion: "skill-input.v1",
      repoId: "acme/qa-skill",
      repoRoot: expectedRepoRoot,
      vcs: "git",
      baseRef: "origin/main",
      headRef: "HEAD",
      runMode: "strict",
      requestedLensIds: null,
      maxConcurrency: 4,
      allowExecutionLensClasses: [],
      defaultPermissionProfileId: "read_only",
      artifactRoot: ".qa-skill",
      runBudgetMaxTokens: 300000,
      runBudgetMaxCostUsd: 12,
      providerBindings: [],
    });

    expect(normalized.permissionProfiles).toEqual([
      DEFAULT_READ_ONLY_PERMISSION_PROFILE,
    ]);
    expect(normalized.configHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

test("normalizeConfigToSkillInput is deterministic for equal input", async () => {
  await withTempDir(async (testDir) => {
    const config: QaRunConfigV1 = {
      runMode: "strict",
      maxConcurrency: 4,
    };

    const options = createNormalizeOptions(testDir, {
      getOriginRemoteUrl: async () => "git@github.com:acme/qa-skill.git",
    });

    const a = await normalizeConfigToSkillInput(config, options);
    const b = await normalizeConfigToSkillInput(config, options);

    expect(a).toEqual(b);
    expect(a.configHash).toBe(b.configHash);
  });
});

test("normalizeConfigToSkillInput preserves explicit null cost budget", async () => {
  await withTempDir(async (testDir) => {
    const normalized = await normalizeConfigToSkillInput(
      {
        runBudgetMaxCostUsd: null,
      },
      createNormalizeOptions(testDir, {
        getOriginRemoteUrl: async () => null,
      }),
    );

    expect(normalized.runBudgetMaxCostUsd).toBeNull();
  });
});

test("normalizeConfigToSkillInput fails when defaultPermissionProfileId is missing", async () => {
  await withTempDir(async (testDir) => {
    try {
      await normalizeConfigToSkillInput(
        {
          permissionProfiles: [DEFAULT_READ_ONLY_PERMISSION_PROFILE],
          defaultPermissionProfileId: "exec_sandboxed",
        },
        createNormalizeOptions(testDir, {
          getOriginRemoteUrl: async () => null,
        }),
      );
      throw new Error("Expected normalizeConfigToSkillInput to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cliError = error as CliError;
      expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
    }
  });
});

test("normalizeConfigToSkillInput rejects repoRoot values that resolve to files", async () => {
  await withTempDir(async (testDir) => {
    const filePath = join(testDir, "not-a-directory.txt");
    await writeFile(filePath, "hello", "utf8");

    try {
      await normalizeConfigToSkillInput(
        { repoRoot: filePath },
        createNormalizeOptions(testDir, {
          getOriginRemoteUrl: async () => null,
        }),
      );
      throw new Error("Expected normalizeConfigToSkillInput to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cliError = error as CliError;
      expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
      expect(cliError.message).toContain("repoRoot is not a directory");
    }
  });
});

test("normalizeConfigToSkillInput rejects schema-invalid normalized payload", async () => {
  await withTempDir(async (testDir) => {
    try {
      await normalizeConfigToSkillInput(
        {
          maxConcurrency: 0,
        },
        createNormalizeOptions(testDir, {
          getOriginRemoteUrl: async () => null,
          resolveBaseRef: async (
            _repoRoot: string,
            configuredBaseRef: string | null | undefined,
          ): Promise<BaseRefResolutionResult> => ({
            requestedBaseRef: configuredBaseRef ?? null,
            resolvedBaseRef: "origin/main",
            warningCodes: [],
          }),
        }),
      );
      throw new Error("Expected normalizeConfigToSkillInput to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cliError = error as CliError;
      expect(cliError.code).toBe("ARTIFACT_SCHEMA_INVALID");
      expect(cliError.message).toContain("skill-input.v1");
    }
  });
});

test("normalizeConfigForRun emits trace with deterministic warning codes", async () => {
  await withTempDir(async (testDir) => {
    const normalized = await normalizeConfigForRun(
      {},
      createNormalizeOptions(testDir, {
        resolveBaseRef: async (): Promise<BaseRefResolutionResult> => ({
          requestedBaseRef: null,
          resolvedBaseRef: "origin/main",
          warningCodes: [
            "BASE_REF_FALLBACK_ORIGIN_HEAD_UNAVAILABLE",
            "BASE_REF_FALLBACK_ORIGIN_MAIN",
          ],
        }),
      }),
    );

    expect(normalized.input.baseRef).toBe("origin/main");
    expect(normalized.trace).toEqual({
      schemaVersion: "trace.v1",
      baseRefResolution: {
        requestedBaseRef: null,
        resolvedBaseRef: "origin/main",
        warningCodes: [
          "BASE_REF_FALLBACK_ORIGIN_HEAD_UNAVAILABLE",
          "BASE_REF_FALLBACK_ORIGIN_MAIN",
        ],
        errorCode: null,
      },
    });
  });
});
