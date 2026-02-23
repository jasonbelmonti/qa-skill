import type { BaseRefErrorCode, BaseRefWarningCode } from "../../contracts/error-codes";
import type { TraceArtifactV1 } from "../../contracts/trace";

export interface BaseRefResolutionResult {
  requestedBaseRef: string | null;
  resolvedBaseRef: string;
  warningCodes: BaseRefWarningCode[];
}

export interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunGitCommandOptions {
  repoRoot: string;
  args: string[];
}

export type GitCommandRunner = (
  options: RunGitCommandOptions,
) => Promise<GitCommandResult>;

export interface ResolveBaseRefOptions {
  runGitCommand?: GitCommandRunner;
}

export class BaseRefResolutionError extends Error {
  readonly deterministicCode: BaseRefErrorCode;
  readonly requestedBaseRef: string | null;
  readonly warningCodes: BaseRefWarningCode[];

  constructor(
    deterministicCode: BaseRefErrorCode,
    message: string,
    requestedBaseRef: string | null,
    warningCodes: BaseRefWarningCode[] = [],
  ) {
    super(message);
    this.deterministicCode = deterministicCode;
    this.requestedBaseRef = requestedBaseRef;
    this.warningCodes = [...warningCodes];
  }

  toTraceArtifact(): TraceArtifactV1 {
    return {
      schemaVersion: "trace.v1",
      baseRefResolution: {
        requestedBaseRef: this.requestedBaseRef,
        resolvedBaseRef: null,
        warningCodes: [...this.warningCodes],
        errorCode: this.deterministicCode,
      },
    };
  }
}
