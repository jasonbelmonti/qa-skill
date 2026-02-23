import { expect, test } from "bun:test";

import {
  resolveBaseRef,
} from "./base-ref-resolver";
import { BaseRefResolutionError, type GitCommandRunner } from "./types";

interface ExpectedCall {
  args: string[];
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

function createSequenceRunner(expectedCalls: ExpectedCall[]): {
  runGitCommand: GitCommandRunner;
  seenArgs: string[][];
  assertDrained: () => void;
} {
  const queue = [...expectedCalls];
  const seenArgs: string[][] = [];

  return {
    runGitCommand: async ({ args }) => {
      seenArgs.push([...args]);
      const next = queue.shift();

      if (!next) {
        throw new Error(`Unexpected git command: ${args.join(" ")}`);
      }

      expect(args).toEqual(next.args);

      return {
        exitCode: next.exitCode,
        stdout: next.stdout ?? "",
        stderr: next.stderr ?? "",
      };
    },
    seenArgs,
    assertDrained: () => {
      expect(queue).toHaveLength(0);
    },
  };
}

function createMapRunner(map: Record<string, ExpectedCall>): GitCommandRunner {
  return async ({ args }) => {
    const key = args.join(" ");
    const match = map[key];

    if (!match) {
      throw new Error(`No mocked response for git command: ${key}`);
    }

    return {
      exitCode: match.exitCode,
      stdout: match.stdout ?? "",
      stderr: match.stderr ?? "",
    };
  };
}

test("resolveBaseRef uses configured baseRef when it exists", async () => {
  const { runGitCommand, assertDrained } = createSequenceRunner([
    {
      args: ["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"],
      exitCode: 0,
    },
  ]);

  const result = await resolveBaseRef("/repo", "refs/heads/main", {
    runGitCommand,
  });

  expect(result).toEqual({
    requestedBaseRef: "refs/heads/main",
    resolvedBaseRef: "refs/heads/main",
    warningCodes: [],
  });

  assertDrained();
});

test("resolveBaseRef fails immediately when configured baseRef is missing", async () => {
  const { runGitCommand, seenArgs, assertDrained } = createSequenceRunner([
    {
      args: ["rev-parse", "--verify", "--quiet", "refs/heads/missing^{commit}"],
      exitCode: 1,
    },
  ]);

  try {
    await resolveBaseRef("/repo", "refs/heads/missing", {
      runGitCommand,
    });
    throw new Error("Expected resolveBaseRef to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(BaseRefResolutionError);
    const resolutionError = error as BaseRefResolutionError;
    expect(resolutionError.deterministicCode).toBe("BASE_REF_CONFIGURED_NOT_FOUND");
    expect(resolutionError.warningCodes).toEqual([]);
    expect(resolutionError.requestedBaseRef).toBe("refs/heads/missing");
    expect(resolutionError.toTraceArtifact().baseRefResolution.errorCode).toBe(
      "BASE_REF_CONFIGURED_NOT_FOUND",
    );
  }

  expect(seenArgs).toHaveLength(1);
  assertDrained();
});

test("resolveBaseRef resolves origin/HEAD when available", async () => {
  const { runGitCommand, assertDrained } = createSequenceRunner([
    {
      args: ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      exitCode: 0,
      stdout: "refs/remotes/origin/main",
    },
    {
      args: ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main^{commit}"],
      exitCode: 0,
    },
  ]);

  const result = await resolveBaseRef("/repo", null, {
    runGitCommand,
  });

  expect(result).toEqual({
    requestedBaseRef: null,
    resolvedBaseRef: "origin/main",
    warningCodes: [],
  });

  assertDrained();
});

test("resolveBaseRef falls back to origin/main with deterministic warning codes", async () => {
  const { runGitCommand, assertDrained } = createSequenceRunner([
    {
      args: ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      exitCode: 1,
    },
    {
      args: ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main^{commit}"],
      exitCode: 0,
    },
  ]);

  const result = await resolveBaseRef("/repo", null, {
    runGitCommand,
  });

  expect(result).toEqual({
    requestedBaseRef: null,
    resolvedBaseRef: "origin/main",
    warningCodes: [
      "BASE_REF_FALLBACK_ORIGIN_HEAD_UNAVAILABLE",
      "BASE_REF_FALLBACK_ORIGIN_MAIN",
    ],
  });

  assertDrained();
});

test("resolveBaseRef falls back to origin/master with deterministic warning codes", async () => {
  const { runGitCommand, assertDrained } = createSequenceRunner([
    {
      args: ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      exitCode: 1,
    },
    {
      args: ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main^{commit}"],
      exitCode: 1,
    },
    {
      args: ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/master^{commit}"],
      exitCode: 0,
    },
  ]);

  const result = await resolveBaseRef("/repo", null, {
    runGitCommand,
  });

  expect(result).toEqual({
    requestedBaseRef: null,
    resolvedBaseRef: "origin/master",
    warningCodes: [
      "BASE_REF_FALLBACK_ORIGIN_HEAD_UNAVAILABLE",
      "BASE_REF_FALLBACK_ORIGIN_MASTER",
    ],
  });

  assertDrained();
});

test("resolveBaseRef fails with deterministic error when all fallbacks are exhausted", async () => {
  const { runGitCommand, assertDrained } = createSequenceRunner([
    {
      args: ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      exitCode: 1,
    },
    {
      args: ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main^{commit}"],
      exitCode: 1,
    },
    {
      args: ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/master^{commit}"],
      exitCode: 1,
    },
  ]);

  try {
    await resolveBaseRef("/repo", null, {
      runGitCommand,
    });
    throw new Error("Expected resolveBaseRef to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(BaseRefResolutionError);
    const resolutionError = error as BaseRefResolutionError;
    expect(resolutionError.deterministicCode).toBe("BASE_REF_RESOLUTION_FAILED");
    expect(resolutionError.warningCodes).toEqual([
      "BASE_REF_FALLBACK_ORIGIN_HEAD_UNAVAILABLE",
    ]);
    expect(resolutionError.requestedBaseRef).toBeNull();
  }

  assertDrained();
});

test("resolveBaseRef is deterministic for identical mocked git responses", async () => {
  const runGitCommand = createMapRunner({
    "symbolic-ref --quiet refs/remotes/origin/HEAD": {
      args: ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      exitCode: 1,
    },
    "rev-parse --verify --quiet refs/remotes/origin/main^{commit}": {
      args: ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main^{commit}"],
      exitCode: 0,
    },
  });

  const first = await resolveBaseRef("/repo", null, { runGitCommand });
  const second = await resolveBaseRef("/repo", null, { runGitCommand });

  expect(first).toEqual(second);
});
