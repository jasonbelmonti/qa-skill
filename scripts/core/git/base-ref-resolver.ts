import {
  ORIGIN_HEAD_SYMBOLIC_REF,
  ORIGIN_MAIN_REF,
  ORIGIN_MASTER_REF,
} from "./constants";
import {
  BaseRefResolutionError,
  type BaseRefResolutionResult,
  type GitCommandResult,
  type GitCommandRunner,
  type ResolveBaseRefOptions,
} from "./types";

function decodeOutput(value: Uint8Array): string {
  return new TextDecoder().decode(value).trim();
}

function normalizeRefName(ref: string): string {
  return ref.trim().replace(/^refs\/remotes\//, "");
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

async function resolveCommitRef(
  repoRoot: string,
  ref: string,
  runGitCommand: GitCommandRunner,
): Promise<boolean> {
  const result = await runGitCommand({
    repoRoot,
    args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
  });

  return result.exitCode === 0;
}

async function resolveOriginHeadTarget(
  repoRoot: string,
  runGitCommand: GitCommandRunner,
): Promise<string | null> {
  const result = await runGitCommand({
    repoRoot,
    args: ["symbolic-ref", "--quiet", ORIGIN_HEAD_SYMBOLIC_REF],
  });

  if (result.exitCode !== 0 || result.stdout.length === 0) {
    return null;
  }

  const ref = result.stdout;
  if (!(await resolveCommitRef(repoRoot, ref, runGitCommand))) {
    return null;
  }

  return normalizeRefName(ref);
}

export async function resolveBaseRef(
  repoRoot: string,
  configuredBaseRef: string | null,
  options: ResolveBaseRefOptions = {},
): Promise<BaseRefResolutionResult> {
  const runGitCommand = options.runGitCommand ?? defaultRunGitCommand;

  if (configuredBaseRef !== null) {
    const found = await resolveCommitRef(repoRoot, configuredBaseRef, runGitCommand);

    if (!found) {
      throw new BaseRefResolutionError(
        "BASE_REF_CONFIGURED_NOT_FOUND",
        `Configured baseRef does not exist: ${configuredBaseRef}`,
        configuredBaseRef,
      );
    }

    return {
      requestedBaseRef: configuredBaseRef,
      resolvedBaseRef: configuredBaseRef,
      warningCodes: [],
    };
  }

  const warningCodes: BaseRefResolutionResult["warningCodes"] = [];

  const originHead = await resolveOriginHeadTarget(repoRoot, runGitCommand);
  if (originHead !== null) {
    return {
      requestedBaseRef: null,
      resolvedBaseRef: originHead,
      warningCodes,
    };
  }

  warningCodes.push("BASE_REF_FALLBACK_ORIGIN_HEAD_UNAVAILABLE");

  const hasOriginMain = await resolveCommitRef(repoRoot, ORIGIN_MAIN_REF, runGitCommand);
  if (hasOriginMain) {
    warningCodes.push("BASE_REF_FALLBACK_ORIGIN_MAIN");
    return {
      requestedBaseRef: null,
      resolvedBaseRef: normalizeRefName(ORIGIN_MAIN_REF),
      warningCodes,
    };
  }

  const hasOriginMaster = await resolveCommitRef(repoRoot, ORIGIN_MASTER_REF, runGitCommand);
  if (hasOriginMaster) {
    warningCodes.push("BASE_REF_FALLBACK_ORIGIN_MASTER");
    return {
      requestedBaseRef: null,
      resolvedBaseRef: normalizeRefName(ORIGIN_MASTER_REF),
      warningCodes,
    };
  }

  throw new BaseRefResolutionError(
    "BASE_REF_RESOLUTION_FAILED",
    "Unable to resolve baseRef from origin/HEAD, origin/main, or origin/master",
    null,
    warningCodes,
  );
}
