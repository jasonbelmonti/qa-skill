import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  collectDiff,
} from "./diff-collector";
import { DiffCollectorError } from "./diff-types";
import type { GitCommandRunner } from "./types";

interface GitCallExpectation {
  args: string[];
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

function runGit(repoRoot: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", repoRoot, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();

  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }

  return stdout;
}

async function withTempDir<T>(fn: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), "qa-skill-diff-"));
  try {
    return await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function createRunner(expectedCalls: GitCallExpectation[]): {
  runGitCommand: GitCommandRunner;
  assertDrained: () => void;
} {
  const queue = [...expectedCalls];

  return {
    runGitCommand: async ({ args }) => {
      const next = queue.shift();
      if (!next) {
        throw new Error(`Unexpected git call: ${args.join(" ")}`);
      }

      expect(args).toEqual(next.args);

      return {
        exitCode: next.exitCode,
        stdout: next.stdout ?? "",
        stderr: next.stderr ?? "",
      };
    },
    assertDrained: () => {
      expect(queue).toHaveLength(0);
    },
  };
}

async function initRepoWithDiffFixture(repoRoot: string): Promise<{ baseRef: string }> {
  runGit(repoRoot, ["init"]);
  runGit(repoRoot, ["config", "user.email", "qa-skill@example.com"]);
  runGit(repoRoot, ["config", "user.name", "QA Skill"]);

  await writeFile(
    join(repoRoot, "alpha.ts"),
    [
      "line-1",
      "line-2",
      "line-3",
      "line-4",
      "line-5",
      "line-6",
      "line-7",
      "line-8",
      "line-9",
      "line-10",
      "",
    ].join("\n"),
    "utf8",
  );

  await writeFile(join(repoRoot, "beta.ts"), "beta\n", "utf8");
  runGit(repoRoot, ["add", "alpha.ts", "beta.ts"]);
  runGit(repoRoot, ["commit", "-m", "base"]);

  const baseRef = runGit(repoRoot, ["rev-parse", "HEAD"]);

  await writeFile(
    join(repoRoot, "alpha.ts"),
    [
      "line-1",
      "line-2-updated",
      "line-3",
      "line-4",
      "line-5",
      "line-6",
      "line-7",
      "line-8-updated",
      "line-9",
      "line-10",
      "",
    ].join("\n"),
    "utf8",
  );

  await writeFile(join(repoRoot, "gamma.ts"), "gamma\n", "utf8");

  await rm(join(repoRoot, "beta.ts"), { force: true });

  runGit(repoRoot, ["add", "-A"]);
  runGit(repoRoot, ["commit", "-m", "head"]);

  return { baseRef };
}

test("collectDiff resolves shas and returns deterministic changed files + hunks", async () => {
  await withTempDir(async (tempDir) => {
    const repoRoot = join(tempDir, "repo");
    await mkdir(repoRoot, { recursive: true });

    const { baseRef } = await initRepoWithDiffFixture(repoRoot);

    const result = await collectDiff(repoRoot, baseRef, "HEAD");

    expect(result.baseRef).toBe(baseRef);
    expect(result.headRef).toBe("HEAD");
    expect(result.baseSha).toMatch(/^[a-f0-9]{40}$/);
    expect(result.headSha).toMatch(/^[a-f0-9]{40}$/);

    expect(result.changedFiles).toEqual(["alpha.ts", "beta.ts", "gamma.ts"]);

    expect(result.hunks.map((hunk) => hunk.filePath)).toEqual([
      "alpha.ts",
      "alpha.ts",
      "beta.ts",
      "gamma.ts",
    ]);

    expect(result.hunks.map((hunk) => hunk.hunkOrdinal)).toEqual([0, 1, 2, 3]);
    expect(result.hunks[0]?.newStart).toBe(2);
    expect(result.hunks[1]?.newStart).toBe(8);
  });
});

test("collectDiff returns byte-stable payloads across repeated runs", async () => {
  await withTempDir(async (tempDir) => {
    const repoRoot = join(tempDir, "repo");
    await mkdir(repoRoot, { recursive: true });

    const { baseRef } = await initRepoWithDiffFixture(repoRoot);

    const first = await collectDiff(repoRoot, baseRef, "HEAD");
    const second = await collectDiff(repoRoot, baseRef, "HEAD");

    expect(first).toEqual(second);
  });
});

test("collectDiff maps missing base refs to deterministic error", async () => {
  await withTempDir(async (tempDir) => {
    const repoRoot = join(tempDir, "repo");
    await mkdir(repoRoot, { recursive: true });

    await initRepoWithDiffFixture(repoRoot);

    try {
      await collectDiff(repoRoot, "refs/heads/does-not-exist", "HEAD");
      throw new Error("Expected collectDiff to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DiffCollectorError);
      const diffError = error as DiffCollectorError;
      expect(diffError.deterministicCode).toBe("BASE_REF_RESOLUTION_FAILED");
      expect(diffError.reason).toBe("BASE_REF_NOT_FOUND");
    }
  });
});

test("collectDiff maps missing head refs to deterministic error", async () => {
  await withTempDir(async (tempDir) => {
    const repoRoot = join(tempDir, "repo");
    await mkdir(repoRoot, { recursive: true });

    const { baseRef } = await initRepoWithDiffFixture(repoRoot);

    try {
      await collectDiff(repoRoot, baseRef, "refs/heads/does-not-exist");
      throw new Error("Expected collectDiff to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DiffCollectorError);
      const diffError = error as DiffCollectorError;
      expect(diffError.deterministicCode).toBe("BASE_REF_RESOLUTION_FAILED");
      expect(diffError.reason).toBe("HEAD_REF_NOT_FOUND");
    }
  });
});

test("collectDiff maps git command launch failures to deterministic error", async () => {
  const runGitCommand: GitCommandRunner = async () => {
    throw new Error("spawn git ENOENT");
  };

  try {
    await collectDiff("/repo", "origin/main", "HEAD", {
      runGitCommand,
    });
    throw new Error("Expected collectDiff to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(DiffCollectorError);
    const diffError = error as DiffCollectorError;
    expect(diffError.deterministicCode).toBe("BASE_REF_RESOLUTION_FAILED");
    expect(diffError.reason).toBe("GIT_COMMAND_FAILED");
  }
});

test("collectDiff consumes deterministic command sequence with injected runner", async () => {
  const { runGitCommand, assertDrained } = createRunner([
    {
      args: [
        "-c",
        "core.quotepath=false",
        "rev-parse",
        "--verify",
        "--quiet",
        "base^{commit}",
      ],
      exitCode: 0,
      stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
    },
    {
      args: [
        "-c",
        "core.quotepath=false",
        "rev-parse",
        "--verify",
        "--quiet",
        "head^{commit}",
      ],
      exitCode: 0,
      stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
    },
    {
      args: [
        "-c",
        "core.quotepath=false",
        "diff",
        "--name-only",
        "--no-renames",
        "--no-ext-diff",
        "--relative",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "--",
      ],
      exitCode: 0,
      stdout: "z.ts\na.ts\n",
    },
    {
      args: [
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-color",
        "--unified=0",
        "--no-renames",
        "--no-ext-diff",
        "--relative",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "--",
      ],
      exitCode: 0,
      stdout: [
        "diff --git a/z.ts b/z.ts",
        "--- a/z.ts",
        "+++ b/z.ts",
        "@@ -1 +1 @@",
        "diff --git a/a.ts b/a.ts",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -2 +2 @@",
        "",
      ].join("\n"),
    },
  ]);

  const result = await collectDiff("/repo", "base", "head", {
    runGitCommand,
  });

  expect(result.changedFiles).toEqual(["a.ts", "z.ts"]);
  expect(result.hunks).toEqual([
    {
      filePath: "a.ts",
      hunkOrdinal: 0,
      oldStart: 2,
      oldLines: 1,
      newStart: 2,
      newLines: 1,
      header: "@@ -2 +2 @@",
    },
    {
      filePath: "z.ts",
      hunkOrdinal: 1,
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      header: "@@ -1 +1 @@",
    },
  ]);

  assertDrained();
});

test("collectDiff preserves leading and trailing whitespace in changed file names", async () => {
  const { runGitCommand, assertDrained } = createRunner([
    {
      args: [
        "-c",
        "core.quotepath=false",
        "rev-parse",
        "--verify",
        "--quiet",
        "base^{commit}",
      ],
      exitCode: 0,
      stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
    },
    {
      args: [
        "-c",
        "core.quotepath=false",
        "rev-parse",
        "--verify",
        "--quiet",
        "head^{commit}",
      ],
      exitCode: 0,
      stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
    },
    {
      args: [
        "-c",
        "core.quotepath=false",
        "diff",
        "--name-only",
        "--no-renames",
        "--no-ext-diff",
        "--relative",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "--",
      ],
      exitCode: 0,
      stdout: " lead.ts\ntrail .ts\n",
    },
    {
      args: [
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-color",
        "--unified=0",
        "--no-renames",
        "--no-ext-diff",
        "--relative",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "--",
      ],
      exitCode: 0,
      stdout: [
        'diff --git "a/ lead.ts" "b/ lead.ts"',
        '--- "a/ lead.ts"',
        '+++ "b/ lead.ts"',
        "@@ -1 +1 @@",
        'diff --git "a/trail .ts" "b/trail .ts"',
        '--- "a/trail .ts"',
        '+++ "b/trail .ts"',
        "@@ -1 +1 @@",
        "",
      ].join("\n"),
    },
  ]);

  const result = await collectDiff("/repo", "base", "head", {
    runGitCommand,
  });

  expect(result.changedFiles).toEqual([" lead.ts", "trail .ts"]);
  expect(result.hunks.map((hunk) => hunk.filePath)).toEqual([
    " lead.ts",
    "trail .ts",
  ]);

  assertDrained();
});

test("collectDiff decodes quoted patch paths without collapsing literal backslashes", async () => {
  const { runGitCommand, assertDrained } = createRunner([
    {
      args: [
        "-c",
        "core.quotepath=false",
        "rev-parse",
        "--verify",
        "--quiet",
        "base^{commit}",
      ],
      exitCode: 0,
      stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
    },
    {
      args: [
        "-c",
        "core.quotepath=false",
        "rev-parse",
        "--verify",
        "--quiet",
        "head^{commit}",
      ],
      exitCode: 0,
      stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
    },
    {
      args: [
        "-c",
        "core.quotepath=false",
        "diff",
        "--name-only",
        "--no-renames",
        "--no-ext-diff",
        "--relative",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "--",
      ],
      exitCode: 0,
      stdout: "slash\\\\n.txt\n",
    },
    {
      args: [
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-color",
        "--unified=0",
        "--no-renames",
        "--no-ext-diff",
        "--relative",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "--",
      ],
      exitCode: 0,
      stdout: [
        'diff --git "a/slash\\\\\\\\n.txt" "b/slash\\\\\\\\n.txt"',
        '--- "a/slash\\\\\\\\n.txt"',
        '+++ "b/slash\\\\\\\\n.txt"',
        "@@ -1 +1 @@",
        "",
      ].join("\n"),
    },
  ]);

  const result = await collectDiff("/repo", "base", "head", {
    runGitCommand,
  });

  expect(result.changedFiles).toEqual(["slash\\\\n.txt"]);
  expect(result.hunks).toEqual([
    {
      filePath: "slash\\\\n.txt",
      hunkOrdinal: 0,
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      header: "@@ -1 +1 @@",
    },
  ]);

  assertDrained();
});
