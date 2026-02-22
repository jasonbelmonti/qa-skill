import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { SkillInput } from "../../contracts/skill-input";
import { CliError } from "../errors";
import {
  prepareOutputDirectory,
  writeNormalizedInputArtifact,
} from "./output";

async function withTempDir<T>(fn: (tempDir: string) => Promise<T>): Promise<T> {
  const testDir = await mkdtemp(join(tmpdir(), "qa-skill-artifacts-"));
  try {
    return await fn(testDir);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}

function buildSkillInput(): SkillInput {
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
    providerBindings: [],
    configHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  };
}

test("writeNormalizedInputArtifact creates artifact exactly once", async () => {
  await withTempDir(async (tempDir) => {
    const outDir = join(tempDir, "out");
    await mkdir(outDir, { recursive: true });
    const input = buildSkillInput();

    const artifactPath = await writeNormalizedInputArtifact(outDir, input);
    const written = await readFile(artifactPath, "utf8");
    expect(written).toContain("\"schemaVersion\": \"skill-input.v1\"");

    try {
      await writeNormalizedInputArtifact(outDir, input);
      throw new Error("Expected second write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cliError = error as CliError;
      expect(cliError.code).toBe("OUT_DIR_NON_EMPTY");
    }
  });
});

test("prepareOutputDirectory validates emptiness after mkdir", async () => {
  await withTempDir(async (tempDir) => {
    const outDir = join(tempDir, "out");
    const first = await prepareOutputDirectory(outDir);
    expect(first).toBe(outDir);

    const input = buildSkillInput();
    await writeNormalizedInputArtifact(outDir, input);

    try {
      await prepareOutputDirectory(outDir);
      throw new Error("Expected prepareOutputDirectory to fail for non-empty dir");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cliError = error as CliError;
      expect(cliError.code).toBe("OUT_DIR_NON_EMPTY");
    }
  });
});
