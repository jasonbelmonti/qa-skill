import { expect, test } from "bun:test";

import type { DiffCollectionResult } from "../git/diff-types";
import { applyContextBounds } from "./bounds";

function createDiff(
  values: Pick<DiffCollectionResult, "changedFiles" | "hunks">,
): DiffCollectionResult {
  return {
    baseRef: "base",
    headRef: "head",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    changedFiles: values.changedFiles,
    hunks: values.hunks,
  };
}

test("applyContextBounds keeps all context when limits are not exceeded", () => {
  const diff = createDiff({
    changedFiles: ["alpha.ts", "beta.ts"],
    hunks: [
      {
        filePath: "alpha.ts",
        hunkOrdinal: 0,
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        header: "@@ -1,2 +1,2 @@",
      },
      {
        filePath: "beta.ts",
        hunkOrdinal: 1,
        oldStart: 3,
        oldLines: 1,
        newStart: 3,
        newLines: 1,
        header: "@@ -3 +3 @@",
      },
    ],
  });

  const result = applyContextBounds(diff);

  expect(result.selectedFiles).toEqual(["alpha.ts", "beta.ts"]);
  expect(result.selectedHunks).toHaveLength(2);
  expect(result.omittedFiles).toEqual([]);
  expect(result.omittedHunks).toEqual([]);
  expect(result.warningCodes).toEqual([]);
  expect(result.errorCodes).toEqual([]);
});

test("applyContextBounds uses deterministic ranking and file-limit tie-breaks", () => {
  const diff = createDiff({
    changedFiles: ["docs/readme.md", "src/z.ts", "src/a.ts"],
    hunks: [
      {
        filePath: "src/z.ts",
        hunkOrdinal: 11,
        oldStart: 10,
        oldLines: 2,
        newStart: 10,
        newLines: 2,
        header: "@@ -10,2 +10,2 @@",
      },
      {
        filePath: "src/a.ts",
        hunkOrdinal: 3,
        oldStart: 4,
        oldLines: 2,
        newStart: 4,
        newLines: 2,
        header: "@@ -4,2 +4,2 @@",
      },
    ],
  });

  const result = applyContextBounds(diff, {
    limits: {
      maxContextFiles: 1,
      maxContextHunks: 10,
      maxContextChangedLines: 100,
      maxDiffFiles: 100,
      maxDiffHunks: 100,
    },
  });

  expect(result.rankedFiles).toEqual(["src/a.ts", "src/z.ts", "docs/readme.md"]);
  expect(result.selectedFiles).toEqual(["src/a.ts"]);
  expect(result.omittedFiles).toEqual(["src/z.ts", "docs/readme.md"]);
  expect(result.omittedHunks.map((hunk) => hunk.reason)).toEqual(["FILE_LIMIT"]);
  expect(result.warningCodes).toEqual(["CONTEXT_BOUND_EXCEEDED"]);
});

test("applyContextBounds emits deterministic line-limit omissions", () => {
  const diff = createDiff({
    changedFiles: ["a.ts", "b.ts"],
    hunks: [
      {
        filePath: "a.ts",
        hunkOrdinal: 0,
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        header: "@@ -1,3 +1,3 @@",
      },
      {
        filePath: "a.ts",
        hunkOrdinal: 1,
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 3,
        header: "@@ -10,3 +10,3 @@",
      },
      {
        filePath: "b.ts",
        hunkOrdinal: 2,
        oldStart: 2,
        oldLines: 1,
        newStart: 2,
        newLines: 1,
        header: "@@ -2 +2 @@",
      },
    ],
  });

  const result = applyContextBounds(diff, {
    limits: {
      maxContextFiles: 4,
      maxContextHunks: 2,
      maxContextChangedLines: 4,
      maxDiffFiles: 100,
      maxDiffHunks: 100,
    },
  });

  expect(result.selectedFiles).toEqual(["a.ts", "b.ts"]);
  expect(result.selectedHunks.map((hunk) => hunk.filePath)).toEqual(["a.ts", "b.ts"]);
  expect(result.omittedFiles).toEqual(["a.ts"]);
  expect(result.omittedHunks).toEqual([
    {
      filePath: "a.ts",
      hunkOrdinal: 1,
      oldStart: 10,
      oldLines: 3,
      newStart: 10,
      newLines: 3,
      changedLines: 3,
      reason: "LINE_LIMIT",
    },
  ]);
  expect(result.warningCodes).toEqual(["CONTEXT_BOUND_EXCEEDED"]);
  expect(result.errorCodes).toEqual([]);
});

test("applyContextBounds emits DIFF_TOO_LARGE for hard file/hunk caps", () => {
  const diff = createDiff({
    changedFiles: ["c.ts", "b.ts", "a.ts"],
    hunks: [
      {
        filePath: "a.ts",
        hunkOrdinal: 0,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@",
      },
      {
        filePath: "b.ts",
        hunkOrdinal: 1,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@",
      },
      {
        filePath: "c.ts",
        hunkOrdinal: 2,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@",
      },
    ],
  });

  const result = applyContextBounds(diff, {
    limits: {
      maxDiffFiles: 2,
      maxDiffHunks: 1,
      maxContextFiles: 10,
      maxContextHunks: 10,
      maxContextChangedLines: 10,
    },
  });

  expect(result.rankedFiles).toEqual(["a.ts", "b.ts", "c.ts"]);
  expect(result.selectedFiles).toEqual(["a.ts"]);
  expect(result.selectedHunks.map((hunk) => hunk.filePath)).toEqual(["a.ts"]);
  expect(result.omittedFiles).toEqual(["b.ts", "c.ts"]);
  expect(result.omittedHunks.map((hunk) => hunk.reason)).toEqual([
    "HARD_FILE_LIMIT",
    "HARD_HUNK_LIMIT",
  ]);
  expect(result.errorCodes).toEqual(["DIFF_TOO_LARGE"]);
  expect(result.warningCodes).toEqual(["CONTEXT_BOUND_EXCEEDED"]);
});

test("applyContextBounds is deterministic regardless of input ordering", () => {
  const first = createDiff({
    changedFiles: ["x.ts", "a.ts", "m.ts"],
    hunks: [
      {
        filePath: "m.ts",
        hunkOrdinal: 8,
        oldStart: 10,
        oldLines: 4,
        newStart: 10,
        newLines: 4,
        header: "@@ -10,4 +10,4 @@",
      },
      {
        filePath: "a.ts",
        hunkOrdinal: 1,
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        header: "@@ -1,3 +1,3 @@",
      },
      {
        filePath: "x.ts",
        hunkOrdinal: 3,
        oldStart: 2,
        oldLines: 2,
        newStart: 2,
        newLines: 2,
        header: "@@ -2,2 +2,2 @@",
      },
    ],
  });

  const second = createDiff({
    changedFiles: ["m.ts", "x.ts", "a.ts"],
    hunks: [
      {
        filePath: "x.ts",
        hunkOrdinal: 3,
        oldStart: 2,
        oldLines: 2,
        newStart: 2,
        newLines: 2,
        header: "@@ -2,2 +2,2 @@",
      },
      {
        filePath: "m.ts",
        hunkOrdinal: 8,
        oldStart: 10,
        oldLines: 4,
        newStart: 10,
        newLines: 4,
        header: "@@ -10,4 +10,4 @@",
      },
      {
        filePath: "a.ts",
        hunkOrdinal: 1,
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        header: "@@ -1,3 +1,3 @@",
      },
    ],
  });

  const limits = {
    maxDiffFiles: 5,
    maxDiffHunks: 5,
    maxContextFiles: 2,
    maxContextHunks: 2,
    maxContextChangedLines: 6,
  };

  const firstResult = applyContextBounds(first, { limits });
  const secondResult = applyContextBounds(second, { limits });

  expect(firstResult).toEqual(secondResult);
});
