import { expect, test } from "bun:test";

import { classifyChangeSurface } from "./change-surface-classifier";
import type { DiffCollectionResult } from "./diff-types";

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

test("classifyChangeSurface maps known file types to deterministic categories", () => {
  const diff = createDiff({
    changedFiles: [
      "src/app/main.ts",
      "src/app/module.mts",
      "src/app/module.cts",
      "tests/integration/config.test.json",
      "docs/README.md",
      "scripts/build.sh",
      ".github/workflows/ci.yaml",
      "assets/logo.png",
      "package.json",
      "notes.txt",
    ],
    hunks: [
      {
        filePath: "src/app/main.ts",
        hunkOrdinal: 0,
        oldStart: 10,
        oldLines: 2,
        newStart: 10,
        newLines: 3,
        header: "@@ -10,2 +10,3 @@ function BuildPlan(scopeDigest)",
      },
      {
        filePath: "tests/integration/config.test.json",
        hunkOrdinal: 1,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@ const fixture = true",
      },
      {
        filePath: "src/app/module.mts",
        hunkOrdinal: 2,
        oldStart: 4,
        oldLines: 1,
        newStart: 4,
        newLines: 1,
        header: "@@ -4 +4 @@ export const MtsValue = 1",
      },
      {
        filePath: "src/app/module.cts",
        hunkOrdinal: 3,
        oldStart: 6,
        oldLines: 1,
        newStart: 6,
        newLines: 1,
        header: "@@ -6 +6 @@ export const CtsValue = 2",
      },
      {
        filePath: "docs/README.md",
        hunkOrdinal: 4,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        header: "@@ -1 +1,2 @@ ## Deterministic Design",
      },
      {
        filePath: "scripts/build.sh",
        hunkOrdinal: 5,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@ run_build step_one",
      },
      {
        filePath: ".github/workflows/ci.yaml",
        hunkOrdinal: 6,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@ jobs: qa",
      },
      {
        filePath: "package.json",
        hunkOrdinal: 7,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@ \"scripts\": { \"test\": \"bun test\" }",
      },
      {
        filePath: "notes.txt",
        hunkOrdinal: 8,
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        header: "@@ -0,0 +1,2 @@ plain text notes",
      },
    ],
  });

  const result = classifyChangeSurface(diff);

  expect(result.files.map((file) => file.filePath)).toEqual([
    ".github/workflows/ci.yaml",
    "assets/logo.png",
    "docs/README.md",
    "notes.txt",
    "package.json",
    "scripts/build.sh",
    "src/app/main.ts",
    "src/app/module.cts",
    "src/app/module.mts",
    "tests/integration/config.test.json",
  ]);

  const byPath = new Map(result.files.map((file) => [file.filePath, file]));

  expect(byPath.get("src/app/main.ts")).toMatchObject({
    bucket: "source",
    scope: "app",
    language: "typescript",
    hunkCount: 1,
    changedLines: 5,
  });
  expect(byPath.get("src/app/module.mts")).toMatchObject({
    bucket: "source",
    scope: "app",
    language: "typescript",
  });
  expect(byPath.get("src/app/module.cts")).toMatchObject({
    bucket: "source",
    scope: "app",
    language: "typescript",
  });
  expect(byPath.get("tests/integration/config.test.json")).toMatchObject({
    bucket: "test",
    scope: "tests",
    language: "json",
  });
  expect(byPath.get("docs/README.md")).toMatchObject({
    bucket: "docs",
    scope: "docs",
    language: "markdown",
  });
  expect(byPath.get("scripts/build.sh")).toMatchObject({
    bucket: "source",
    scope: "tooling",
    language: "shell",
  });
  expect(byPath.get(".github/workflows/ci.yaml")).toMatchObject({
    bucket: "infra",
    scope: "infra",
    language: "yaml",
  });
  expect(byPath.get("assets/logo.png")).toMatchObject({
    bucket: "asset",
    scope: "repo",
    language: "binary",
    hunkCount: 0,
    changedLines: 0,
    symbols: [],
  });
  expect(byPath.get("package.json")).toMatchObject({
    bucket: "config",
    scope: "repo",
    language: "json",
  });
  expect(byPath.get("notes.txt")).toMatchObject({
    bucket: "unknown",
    scope: "repo",
    language: "text",
  });

  expect(result.bucketCounts.map((entry) => entry.bucket)).toEqual([
    "source",
    "test",
    "docs",
    "config",
    "infra",
    "asset",
    "unknown",
  ]);
  expect(result.scopeCounts.map((entry) => entry.scope)).toEqual([
    "app",
    "tests",
    "docs",
    "tooling",
    "infra",
    "repo",
  ]);
  expect(result.languageCounts.map((entry) => entry.language)).toEqual([
    "typescript",
    "json",
    "yaml",
    "markdown",
    "shell",
    "text",
    "binary",
  ]);
});

test("classifyChangeSurface applies deterministic precedence for test paths", () => {
  const diff = createDiff({
    changedFiles: [
      "docs/tests/example.spec.ts",
      "tests/runtime/config.json",
      "src/tests/helpers.ts",
    ],
    hunks: [
      {
        filePath: "docs/tests/example.spec.ts",
        hunkOrdinal: 0,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@ test_case",
      },
      {
        filePath: "tests/runtime/config.json",
        hunkOrdinal: 1,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@ fixture",
      },
      {
        filePath: "src/tests/helpers.ts",
        hunkOrdinal: 2,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@ helper",
      },
    ],
  });

  const result = classifyChangeSurface(diff);

  for (const file of result.files) {
    expect(file.bucket).toBe("test");
    expect(file.scope).toBe("tests");
  }
});

test("classifyChangeSurface uses explicit unknown fallback for edge file types", () => {
  const diff = createDiff({
    changedFiles: ["README", "weird/file.customext"],
    hunks: [
      {
        filePath: "weird/file.customext",
        hunkOrdinal: 0,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@ custom",
      },
    ],
  });

  const result = classifyChangeSurface(diff);
  const byPath = new Map(result.files.map((file) => [file.filePath, file]));

  expect(byPath.get("README")).toMatchObject({
    bucket: "unknown",
    language: "unknown",
  });
  expect(byPath.get("weird/file.customext")).toMatchObject({
    bucket: "unknown",
    language: "unknown",
  });
});

test("classifyChangeSurface extracts deterministic lowercase symbol hints from hunk headers", () => {
  const diff = createDiff({
    changedFiles: ["src/parser.ts"],
    hunks: [
      {
        filePath: "src/parser.ts",
        hunkOrdinal: 0,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@ function FooBar foo_bar foo_bar",
      },
      {
        filePath: "src/parser.ts",
        hunkOrdinal: 1,
        oldStart: 10,
        oldLines: 1,
        newStart: 10,
        newLines: 1,
        header: "@@ -10 +10 @@ let baz FooBar",
      },
    ],
  });

  const result = classifyChangeSurface(diff);
  expect(result.files).toHaveLength(1);
  expect(result.files[0]?.symbols).toEqual([
    "baz",
    "foo_bar",
    "foobar",
    "function",
    "let",
  ]);
});

test("classifyChangeSurface is deterministic regardless of changedFiles and hunk ordering", () => {
  const first = createDiff({
    changedFiles: ["b.ts", "a.ts", "c.ts"],
    hunks: [
      {
        filePath: "c.ts",
        hunkOrdinal: 2,
        oldStart: 5,
        oldLines: 2,
        newStart: 5,
        newLines: 1,
        header: "@@ -5,2 +5 @@ gamma",
      },
      {
        filePath: "a.ts",
        hunkOrdinal: 0,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        header: "@@ -1 +1,2 @@ alpha",
      },
      {
        filePath: "b.ts",
        hunkOrdinal: 1,
        oldStart: 3,
        oldLines: 1,
        newStart: 3,
        newLines: 1,
        header: "@@ -3 +3 @@ beta",
      },
    ],
  });

  const second = createDiff({
    changedFiles: ["c.ts", "a.ts", "b.ts"],
    hunks: [
      {
        filePath: "b.ts",
        hunkOrdinal: 10,
        oldStart: 3,
        oldLines: 1,
        newStart: 3,
        newLines: 1,
        header: "@@ -3 +3 @@ beta",
      },
      {
        filePath: "c.ts",
        hunkOrdinal: 9,
        oldStart: 5,
        oldLines: 2,
        newStart: 5,
        newLines: 1,
        header: "@@ -5,2 +5 @@ gamma",
      },
      {
        filePath: "a.ts",
        hunkOrdinal: 8,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        header: "@@ -1 +1,2 @@ alpha",
      },
    ],
  });

  expect(classifyChangeSurface(first)).toEqual(classifyChangeSurface(second));
});

test("classifyChangeSurface ranks ties by changedLines, then hunkCount, then filePath", () => {
  const diff = createDiff({
    changedFiles: ["b.ts", "a.ts", "c.ts"],
    hunks: [
      {
        filePath: "b.ts",
        hunkOrdinal: 0,
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        header: "@@ -1,2 +1,2 @@ b",
      },
      {
        filePath: "a.ts",
        hunkOrdinal: 1,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@ a1",
      },
      {
        filePath: "a.ts",
        hunkOrdinal: 2,
        oldStart: 5,
        oldLines: 1,
        newStart: 5,
        newLines: 1,
        header: "@@ -5 +5 @@ a2",
      },
      {
        filePath: "c.ts",
        hunkOrdinal: 3,
        oldStart: 3,
        oldLines: 2,
        newStart: 3,
        newLines: 2,
        header: "@@ -3,2 +3,2 @@ c",
      },
    ],
  });

  const result = classifyChangeSurface(diff);
  expect(result.rankedFilePaths).toEqual(["a.ts", "b.ts", "c.ts"]);
});

test("classifyChangeSurface keeps zero-hunk changed files with stable defaults", () => {
  const diff = createDiff({
    changedFiles: ["empty.ts"],
    hunks: [],
  });

  const result = classifyChangeSurface(diff);
  expect(result.files).toEqual([
    {
      filePath: "empty.ts",
      bucket: "source",
      scope: "repo",
      language: "typescript",
      hunkCount: 0,
      changedLines: 0,
      symbols: [],
    },
  ]);
  expect(result.rankedFilePaths).toEqual(["empty.ts"]);
});

test("classifyChangeSurface returns byte-identical output on repeated runs", () => {
  const diff = createDiff({
    changedFiles: ["src/main.ts", "README"],
    hunks: [
      {
        filePath: "src/main.ts",
        hunkOrdinal: 0,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "@@ -1 +1 @@ MainEntry",
      },
      {
        filePath: "README",
        hunkOrdinal: 1,
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        header: "@@ -0,0 +1 @@ Overview",
      },
    ],
  });

  const first = classifyChangeSurface(diff);
  const second = classifyChangeSurface(diff);

  expect(first).toEqual(second);
});
