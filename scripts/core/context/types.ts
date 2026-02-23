import type { ErrorCode } from "../../contracts/common";
import type { DiffHunk } from "../git/diff-types";

export type ContextBoundsWarningCode = Extract<ErrorCode, "CONTEXT_BOUND_EXCEEDED">;
export type ContextBoundsErrorCode = Extract<ErrorCode, "DIFF_TOO_LARGE">;

export type ContextOmissionReason =
  | "HARD_FILE_LIMIT"
  | "HARD_HUNK_LIMIT"
  | "FILE_LIMIT"
  | "HUNK_LIMIT"
  | "LINE_LIMIT";

export interface ContextBoundsLimits {
  maxDiffFiles: number;
  maxDiffHunks: number;
  maxContextFiles: number;
  maxContextHunks: number;
  maxContextChangedLines: number;
}

export interface ContextBoundsOptions {
  limits?: Partial<ContextBoundsLimits>;
}

export interface OmittedContextHunk {
  filePath: string;
  hunkOrdinal: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changedLines: number;
  reason: ContextOmissionReason;
}

export interface ContextBoundsTotals {
  totalFiles: number;
  totalHunks: number;
  totalChangedLines: number;
  selectedFiles: number;
  selectedHunks: number;
  selectedChangedLines: number;
  omittedFiles: number;
  omittedHunks: number;
}

export interface ContextBoundsResult {
  limits: ContextBoundsLimits;
  rankedFiles: string[];
  selectedFiles: string[];
  selectedHunks: DiffHunk[];
  omittedFiles: string[];
  omittedHunks: OmittedContextHunk[];
  warningCodes: ContextBoundsWarningCode[];
  errorCodes: ContextBoundsErrorCode[];
  totals: ContextBoundsTotals;
}
