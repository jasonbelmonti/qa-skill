import type { ErrorCode } from "../../contracts/common";
import type { GitCommandRunner } from "./types";

export type DiffCollectorDeterministicCode = Extract<
  ErrorCode,
  "BASE_REF_RESOLUTION_FAILED"
>;

export type DiffCollectorFailureReason =
  | "BASE_REF_NOT_FOUND"
  | "HEAD_REF_NOT_FOUND"
  | "GIT_COMMAND_FAILED"
  | "DIFF_PARSE_ERROR";

export interface DiffHunk {
  filePath: string;
  hunkOrdinal: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
}

export interface DiffCollectionResult {
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  changedFiles: string[];
  hunks: DiffHunk[];
}

export interface CollectDiffOptions {
  runGitCommand?: GitCommandRunner;
}

export class DiffCollectorError extends Error {
  readonly deterministicCode: DiffCollectorDeterministicCode;
  readonly reason: DiffCollectorFailureReason;
  readonly baseRef: string;
  readonly headRef: string;

  constructor(
    reason: DiffCollectorFailureReason,
    message: string,
    baseRef: string,
    headRef: string,
  ) {
    super(message);
    this.deterministicCode = "BASE_REF_RESOLUTION_FAILED";
    this.reason = reason;
    this.baseRef = baseRef;
    this.headRef = headRef;
  }
}
