import type { DiffCollectionResult, DiffHunk } from "../git/diff-types";
import { DEFAULT_CONTEXT_BOUNDS_LIMITS } from "./constants";
import type {
  ContextBoundsErrorCode,
  ContextBoundsLimits,
  ContextBoundsOptions,
  ContextBoundsResult,
  ContextBoundsWarningCode,
  ContextOmissionReason,
  OmittedContextHunk,
} from "./types";

interface FileStats {
  filePath: string;
  hunkCount: number;
  changedLines: number;
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function normalizeLimits(
  limits: Partial<ContextBoundsLimits> | undefined,
): ContextBoundsLimits {
  const normalized: ContextBoundsLimits = {
    maxDiffFiles: limits?.maxDiffFiles ?? DEFAULT_CONTEXT_BOUNDS_LIMITS.maxDiffFiles,
    maxDiffHunks: limits?.maxDiffHunks ?? DEFAULT_CONTEXT_BOUNDS_LIMITS.maxDiffHunks,
    maxContextFiles:
      limits?.maxContextFiles ?? DEFAULT_CONTEXT_BOUNDS_LIMITS.maxContextFiles,
    maxContextHunks:
      limits?.maxContextHunks ?? DEFAULT_CONTEXT_BOUNDS_LIMITS.maxContextHunks,
    maxContextChangedLines:
      limits?.maxContextChangedLines ??
      DEFAULT_CONTEXT_BOUNDS_LIMITS.maxContextChangedLines,
  };

  for (const [key, value] of Object.entries(normalized)) {
    if (!isPositiveInteger(value)) {
      throw new Error(`Invalid context bound limit ${key}: ${value}`);
    }
  }

  return normalized;
}

function getChangedLines(hunk: DiffHunk): number {
  return Math.max(hunk.oldLines, hunk.newLines);
}

function normalizeHunks(hunks: readonly DiffHunk[]): DiffHunk[] {
  return [...hunks].sort((left, right) => {
    return (
      compareStrings(left.filePath, right.filePath) ||
      left.hunkOrdinal - right.hunkOrdinal ||
      left.newStart - right.newStart ||
      left.oldStart - right.oldStart ||
      compareStrings(left.header, right.header)
    );
  });
}

function buildFileStats(
  changedFiles: readonly string[],
  hunks: readonly DiffHunk[],
): FileStats[] {
  const byFile = new Map<string, FileStats>();

  for (const filePath of changedFiles) {
    byFile.set(filePath, {
      filePath,
      hunkCount: 0,
      changedLines: 0,
    });
  }

  for (const hunk of hunks) {
    const next = byFile.get(hunk.filePath) ?? {
      filePath: hunk.filePath,
      hunkCount: 0,
      changedLines: 0,
    };
    next.hunkCount += 1;
    next.changedLines += getChangedLines(hunk);
    byFile.set(hunk.filePath, next);
  }

  return [...byFile.values()].sort((left, right) => {
    return (
      right.changedLines - left.changedLines ||
      right.hunkCount - left.hunkCount ||
      compareStrings(left.filePath, right.filePath)
    );
  });
}

function pushUniqueCode<T extends string>(list: T[], code: T): void {
  if (!list.includes(code)) {
    list.push(code);
  }
}

function pushOmittedHunk(
  omittedHunks: OmittedContextHunk[],
  omittedFiles: Set<string>,
  hunk: DiffHunk,
  reason: ContextOmissionReason,
): void {
  omittedFiles.add(hunk.filePath);
  omittedHunks.push({
    filePath: hunk.filePath,
    hunkOrdinal: hunk.hunkOrdinal,
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    changedLines: getChangedLines(hunk),
    reason,
  });
}

export function applyContextBounds(
  diff: DiffCollectionResult,
  options: ContextBoundsOptions = {},
): ContextBoundsResult {
  const limits = normalizeLimits(options.limits);
  const warningCodes: ContextBoundsWarningCode[] = [];
  const errorCodes: ContextBoundsErrorCode[] = [];

  const normalizedHunks = normalizeHunks(diff.hunks);
  const fileStats = buildFileStats(diff.changedFiles, normalizedHunks);
  const rankedFiles = fileStats.map((entry) => entry.filePath);
  const totalChangedLines = normalizedHunks.reduce(
    (accumulator, hunk) => accumulator + getChangedLines(hunk),
    0,
  );

  const hunksByFile = new Map<string, DiffHunk[]>();
  for (const hunk of normalizedHunks) {
    const fileHunks = hunksByFile.get(hunk.filePath) ?? [];
    fileHunks.push(hunk);
    hunksByFile.set(hunk.filePath, fileHunks);
  }

  const omittedFiles = new Set<string>();
  const omittedHunks: OmittedContextHunk[] = [];

  const candidateFiles = rankedFiles.slice(0, limits.maxDiffFiles);
  const hardOmittedFiles = rankedFiles.slice(limits.maxDiffFiles);
  if (hardOmittedFiles.length > 0) {
    pushUniqueCode(errorCodes, "DIFF_TOO_LARGE");
    for (const filePath of hardOmittedFiles) {
      omittedFiles.add(filePath);
      for (const hunk of hunksByFile.get(filePath) ?? []) {
        pushOmittedHunk(omittedHunks, omittedFiles, hunk, "HARD_FILE_LIMIT");
      }
    }
  }

  const candidateHunksByFile = new Map<string, DiffHunk[]>();
  for (const filePath of candidateFiles) {
    candidateHunksByFile.set(filePath, [...(hunksByFile.get(filePath) ?? [])]);
  }

  let seenHunks = 0;
  for (const filePath of candidateFiles) {
    const hunks = candidateHunksByFile.get(filePath) ?? [];
    const keptHunks: DiffHunk[] = [];

    for (const hunk of hunks) {
      if (seenHunks < limits.maxDiffHunks) {
        keptHunks.push(hunk);
        seenHunks += 1;
        continue;
      }

      pushUniqueCode(errorCodes, "DIFF_TOO_LARGE");
      pushOmittedHunk(omittedHunks, omittedFiles, hunk, "HARD_HUNK_LIMIT");
    }

    candidateHunksByFile.set(filePath, keptHunks);
  }

  const selectedFiles: string[] = [];
  const selectedHunks: DiffHunk[] = [];
  let selectedChangedLines = 0;

  for (const filePath of candidateFiles) {
    const originalHunkCount = (hunksByFile.get(filePath) ?? []).length;
    const fileHunks = candidateHunksByFile.get(filePath) ?? [];

    if (selectedFiles.length >= limits.maxContextFiles) {
      omittedFiles.add(filePath);
      for (const hunk of fileHunks) {
        pushOmittedHunk(omittedHunks, omittedFiles, hunk, "FILE_LIMIT");
      }
      continue;
    }

    const selectedCountBefore = selectedHunks.length;

    for (const hunk of fileHunks) {
      if (selectedHunks.length >= limits.maxContextHunks) {
        pushOmittedHunk(omittedHunks, omittedFiles, hunk, "HUNK_LIMIT");
        continue;
      }

      const changedLines = getChangedLines(hunk);
      if (selectedChangedLines + changedLines > limits.maxContextChangedLines) {
        pushOmittedHunk(omittedHunks, omittedFiles, hunk, "LINE_LIMIT");
        continue;
      }

      selectedHunks.push(hunk);
      selectedChangedLines += changedLines;
    }

    const selectedInFile = selectedHunks.length > selectedCountBefore;
    if (selectedInFile || originalHunkCount === 0) {
      selectedFiles.push(filePath);
      continue;
    }

    omittedFiles.add(filePath);
  }

  if (omittedFiles.size > 0 || omittedHunks.length > 0) {
    pushUniqueCode(warningCodes, "CONTEXT_BOUND_EXCEEDED");
  }

  const orderedOmittedFiles = rankedFiles.filter((filePath) =>
    omittedFiles.has(filePath),
  );

  return {
    limits,
    rankedFiles,
    selectedFiles,
    selectedHunks,
    omittedFiles: orderedOmittedFiles,
    omittedHunks,
    warningCodes,
    errorCodes,
    totals: {
      totalFiles: rankedFiles.length,
      totalHunks: normalizedHunks.length,
      totalChangedLines,
      selectedFiles: selectedFiles.length,
      selectedHunks: selectedHunks.length,
      selectedChangedLines,
      omittedFiles: orderedOmittedFiles.length,
      omittedHunks: omittedHunks.length,
    },
  };
}
