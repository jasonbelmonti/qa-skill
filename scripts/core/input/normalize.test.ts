import { expect, test } from "bun:test";

import type { QaRunConfigV1 } from "../../contracts/config";
import { CliError } from "../errors";
import { DEFAULT_READ_ONLY_PERMISSION_PROFILE } from "./constants";
import {
  deriveRepoIdFromRemoteUrl,
  normalizeConfigToSkillInput,
} from "./normalize";

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
    deriveRepoIdFromRemoteUrl("git@github.com:jasonbelmonti/qa-skill.git", "/tmp/qa-skill"),
  ).toBe("jasonbelmonti/qa-skill");
});

test("deriveRepoIdFromRemoteUrl falls back to repo directory when remote is unavailable", () => {
  expect(deriveRepoIdFromRemoteUrl(null, "/tmp/qa-skill")).toBe("qa-skill");
});

test("normalizeConfigToSkillInput applies deterministic defaults", async () => {
  const normalized = await normalizeConfigToSkillInput(
    {},
    {
      cwd: "/tmp/qa-skill",
      resolveRealpath: async (path) => path,
      getOriginRemoteUrl: async () => "https://github.com/acme/qa-skill.git",
    },
  );

  expect(normalized).toMatchObject({
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

test("normalizeConfigToSkillInput is deterministic for equal input", async () => {
  const config: QaRunConfigV1 = {
    runMode: "strict",
    maxConcurrency: 4,
  };

  const options = {
    cwd: "/tmp/qa-skill",
    resolveRealpath: async (path: string) => path,
    getOriginRemoteUrl: async () => "git@github.com:acme/qa-skill.git",
  };

  const a = await normalizeConfigToSkillInput(config, options);
  const b = await normalizeConfigToSkillInput(config, options);

  expect(a).toEqual(b);
  expect(a.configHash).toBe(b.configHash);
});

test("normalizeConfigToSkillInput preserves explicit null cost budget", async () => {
  const normalized = await normalizeConfigToSkillInput(
    {
      runBudgetMaxCostUsd: null,
    },
    {
      cwd: "/tmp/qa-skill",
      resolveRealpath: async (path) => path,
      getOriginRemoteUrl: async () => null,
    },
  );

  expect(normalized.runBudgetMaxCostUsd).toBeNull();
});

test("normalizeConfigToSkillInput fails when defaultPermissionProfileId is missing", async () => {
  try {
    await normalizeConfigToSkillInput(
      {
        permissionProfiles: [DEFAULT_READ_ONLY_PERMISSION_PROFILE],
        defaultPermissionProfileId: "exec_sandboxed",
      },
      {
        cwd: "/tmp/qa-skill",
        resolveRealpath: async (path) => path,
        getOriginRemoteUrl: async () => null,
      },
    );
    throw new Error("Expected normalizeConfigToSkillInput to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    const cliError = error as CliError;
    expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
  }
});
