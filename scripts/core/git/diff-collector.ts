import { GIT_QUOTE_PATH_DISABLED_ARGS, HUNK_HEADER_PATTERN } from "./diff-constants";
import {
  DiffCollectorError,
  type CollectDiffOptions,
  type DiffCollectionResult,
  type DiffHunk,
} from "./diff-types";
import type { GitCommandResult, GitCommandRunner } from "./types";

function decodeOutput(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

async function defaultRunGitCommand(
  options: { repoRoot: string; args: string[] },
): Promise<GitCommandResult> {
  const processResult = Bun.spawnSync(["git", "-C", options.repoRoot, ...options.args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: processResult.exitCode,
    stdout: decodeOutput(processResult.stdout),
    stderr: decodeOutput(processResult.stderr),
  };
}

async function runGitCommandSafely(
  repoRoot: string,
  args: string[],
  runGitCommand: GitCommandRunner,
  baseRef: string,
  headRef: string,
): Promise<GitCommandResult> {
  try {
    return await runGitCommand({ repoRoot, args });
  } catch {
    throw new DiffCollectorError(
      "GIT_COMMAND_FAILED",
      `Unable to execute git command: ${args.join(" ")}`,
      baseRef,
      headRef,
    );
  }
}

function resolveCount(value: string | undefined): number {
  if (value === undefined) {
    return 1;
  }

  return Number.parseInt(value, 10);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function decodeGitQuotedPath(value: string): string {
  let decoded = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char !== "\\") {
      decoded += char;
      continue;
    }

    const next = value[index + 1];
    if (next === undefined) {
      decoded += "\\";
      continue;
    }

    if (next >= "0" && next <= "7") {
      let octal = next;
      let octalIndex = index + 2;

      while (octalIndex < value.length && octal.length < 3) {
        const candidate = value[octalIndex];
        if (candidate < "0" || candidate > "7") {
          break;
        }
        octal += candidate;
        octalIndex += 1;
      }

      decoded += String.fromCharCode(Number.parseInt(octal, 8));
      index = octalIndex - 1;
      continue;
    }

    const escapeMap: Record<string, string> = {
      a: "\u0007",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\u000B",
      '"': '"',
      "\\": "\\",
    };

    if (Object.prototype.hasOwnProperty.call(escapeMap, next)) {
      decoded += escapeMap[next];
      index += 1;
      continue;
    }

    // Unknown escape sequences are treated literally to avoid data loss.
    decoded += next;
    index += 1;
  }

  return decoded;
}

function normalizePatchPath(value: string): string | null {
  let normalized = value;
  if (normalized === "/dev/null") {
    return null;
  }

  if (normalized.startsWith('"') && normalized.endsWith('"') && normalized.length >= 2) {
    normalized = decodeGitQuotedPath(normalized.slice(1, -1));
  }

  if (normalized.startsWith("a/") || normalized.startsWith("b/")) {
    normalized = normalized.slice(2);
  }

  return normalized;
}

function parseDiffHunks(
  diffOutput: string,
  baseRef: string,
  headRef: string,
): DiffHunk[] {
  const hunks: Omit<DiffHunk, "hunkOrdinal">[] = [];
  const lines = diffOutput.split(/\r?\n/);

  let minusPath: string | null = null;
  let plusPath: string | null = null;
  let currentFilePath: string | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      minusPath = null;
      plusPath = null;
      currentFilePath = null;
      continue;
    }

    if (line.startsWith("--- ")) {
      minusPath = normalizePatchPath(line.slice(4));
      if (minusPath !== null && plusPath === null) {
        currentFilePath = minusPath;
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      plusPath = normalizePatchPath(line.slice(4));
      currentFilePath = plusPath ?? minusPath;
      continue;
    }

    if (!line.startsWith("@@ ")) {
      continue;
    }

    if (currentFilePath === null) {
      throw new DiffCollectorError(
        "DIFF_PARSE_ERROR",
        `Unable to parse diff hunk without file header: ${line}`,
        baseRef,
        headRef,
      );
    }

    const match = line.match(HUNK_HEADER_PATTERN);
    if (!match) {
      throw new DiffCollectorError(
        "DIFF_PARSE_ERROR",
        `Unable to parse diff hunk header: ${line}`,
        baseRef,
        headRef,
      );
    }

    hunks.push({
      filePath: currentFilePath,
      oldStart: Number.parseInt(match[1] ?? "0", 10),
      oldLines: resolveCount(match[2]),
      newStart: Number.parseInt(match[3] ?? "0", 10),
      newLines: resolveCount(match[4]),
      header: line,
    });
  }

  const sortedHunks = [...hunks].sort((left, right) => {
    return (
      left.filePath.localeCompare(right.filePath) ||
      left.newStart - right.newStart ||
      left.oldStart - right.oldStart ||
      left.header.localeCompare(right.header)
    );
  });

  return sortedHunks.map((hunk, index) => ({
    ...hunk,
    hunkOrdinal: index,
  }));
}

async function resolveCommitSha(
  repoRoot: string,
  ref: string,
  label: "base" | "head",
  runGitCommand: GitCommandRunner,
  baseRef: string,
  headRef: string,
): Promise<string> {
  const result = await runGitCommandSafely(
    repoRoot,
    [
      ...GIT_QUOTE_PATH_DISABLED_ARGS,
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^{commit}`,
    ],
    runGitCommand,
    baseRef,
    headRef,
  );

  if (result.exitCode !== 0) {
    throw new DiffCollectorError(
      label === "base" ? "BASE_REF_NOT_FOUND" : "HEAD_REF_NOT_FOUND",
      `${label === "base" ? "baseRef" : "headRef"} does not resolve to a commit: ${ref}`,
      baseRef,
      headRef,
    );
  }

  const sha = result.stdout.trim().split(/\s+/)[0];
  if (!sha) {
    throw new DiffCollectorError(
      label === "base" ? "BASE_REF_NOT_FOUND" : "HEAD_REF_NOT_FOUND",
      `${label === "base" ? "baseRef" : "headRef"} does not resolve to a commit: ${ref}`,
      baseRef,
      headRef,
    );
  }

  return sha;
}

export async function collectDiff(
  repoRoot: string,
  baseRef: string,
  headRef: string,
  options: CollectDiffOptions = {},
): Promise<DiffCollectionResult> {
  const runGitCommand = options.runGitCommand ?? defaultRunGitCommand;

  const baseSha = await resolveCommitSha(
    repoRoot,
    baseRef,
    "base",
    runGitCommand,
    baseRef,
    headRef,
  );
  const headSha = await resolveCommitSha(
    repoRoot,
    headRef,
    "head",
    runGitCommand,
    baseRef,
    headRef,
  );

  const changedFilesResult = await runGitCommandSafely(
    repoRoot,
    [
      ...GIT_QUOTE_PATH_DISABLED_ARGS,
      "diff",
      "--name-only",
      "--no-renames",
      "--no-ext-diff",
      "--relative",
      baseSha,
      headSha,
      "--",
    ],
    runGitCommand,
    baseRef,
    headRef,
  );

  if (changedFilesResult.exitCode !== 0) {
    throw new DiffCollectorError(
      "GIT_COMMAND_FAILED",
      "Unable to collect changed files via git diff --name-only",
      baseRef,
      headRef,
    );
  }

  const patchResult = await runGitCommandSafely(
    repoRoot,
    [
      ...GIT_QUOTE_PATH_DISABLED_ARGS,
      "diff",
      "--no-color",
      "--unified=0",
      "--no-renames",
      "--no-ext-diff",
      "--relative",
      baseSha,
      headSha,
      "--",
    ],
    runGitCommand,
    baseRef,
    headRef,
  );

  if (patchResult.exitCode !== 0) {
    throw new DiffCollectorError(
      "GIT_COMMAND_FAILED",
      "Unable to collect changed hunks via git diff",
      baseRef,
      headRef,
    );
  }

  const changedFiles = uniqueSorted(
    changedFilesResult.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0),
  );

  const hunks = parseDiffHunks(patchResult.stdout, baseRef, headRef);

  return {
    baseRef,
    headRef,
    baseSha,
    headSha,
    changedFiles,
    hunks,
  };
}
