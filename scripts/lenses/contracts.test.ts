import { expect, test } from "bun:test";

import {
  assertLensDefinition,
  compareLensIdentity,
  formatLensContractIssues,
  normalizeLensDefinitions,
  toLensIdentity,
  type LensContractIssue,
  type LensDefinition,
} from "./contracts";

function buildLens(id: string, lensClass: LensDefinition["lensClass"]): LensDefinition {
  return {
    lensId: id,
    lensVersion: "1.0.0",
    lensClass,
    title: `${id} title`,
    description: `${id} description`,
    requiredByDefault: true,
    defaultPermissionProfileId: "read_only",
    trigger: {
      includeGlobs: ["**/*.ts", "**/*.tsx"],
      excludeGlobs: ["**/*.snap.ts"],
      pathPrefixes: ["src/", "scripts/"],
      symbolHints: ["Planner", "RunMode"],
      minConfidence: 0.7,
    },
    subLenses: [
      {
        subLensId: "z-sub",
        title: "z-sub title",
        description: "z-sub description",
        required: false,
        blockingPolicy: "rule_defined",
        trigger: {
          includeGlobs: ["z/**/*.ts"],
          excludeGlobs: [],
          pathPrefixes: ["z/"],
          symbolHints: ["zHint"],
          minConfidence: 0.2,
        },
      },
      {
        subLensId: "a-sub",
        title: "a-sub title",
        description: "a-sub description",
        required: true,
        blockingPolicy: "mixed",
        trigger: {
          includeGlobs: ["a/**/*.ts"],
          excludeGlobs: [],
          pathPrefixes: ["a/"],
          symbolHints: ["aHint"],
          minConfidence: 0.8,
        },
      },
    ],
  };
}

function isSorted(issues: readonly LensContractIssue[]): boolean {
  for (let index = 1; index < issues.length; index += 1) {
    const prev = issues[index - 1];
    const curr = issues[index];
    const prevKey = `${prev.path}\u0000${prev.message}`;
    const currKey = `${curr.path}\u0000${curr.message}`;
    if (prevKey > currKey) {
      return false;
    }
  }
  return true;
}

test("normalizeLensDefinitions sorts lenses and sub-lenses deterministically", () => {
  const style = buildLens("style-lens", "style");
  const consistency = buildLens("consistency-lens", "consistency");
  const security = buildLens("security-lens", "security");

  const normalized = normalizeLensDefinitions([style, consistency, security]);

  expect(normalized.map((lens) => lens.lensId)).toEqual([
    "consistency-lens",
    "security-lens",
    "style-lens",
  ]);
  expect(normalized[0].subLenses.map((subLens) => subLens.subLensId)).toEqual([
    "a-sub",
    "z-sub",
  ]);
  expect(normalized[0].trigger.includeGlobs).toEqual(["**/*.ts", "**/*.tsx"]);
  expect(normalized[0].trigger.symbolHints).toEqual(["Planner", "RunMode"]);
});

test("compareLensIdentity applies class priority then lexical tie-break rules", () => {
  const consistency = toLensIdentity(buildLens("consistency-lens", "consistency"));
  const style = toLensIdentity(buildLens("style-lens", "style"));

  expect(compareLensIdentity(consistency, style)).toBeLessThan(0);
  expect(compareLensIdentity(style, consistency)).toBeGreaterThan(0);

  const parent = toLensIdentity(buildLens("consistency-lens", "consistency"), null);
  const child = toLensIdentity(buildLens("consistency-lens", "consistency"), {
    subLensId: "a-sub",
  });
  expect(compareLensIdentity(parent, child)).toBeLessThan(0);
});

test("assertLensDefinition rejects invalid/partial definitions deterministically", () => {
  const invalidDefinition: unknown = {
    lensId: "",
    lensVersion: 12,
    lensClass: "made-up-class",
    title: " ",
    description: 42,
    requiredByDefault: "yes",
    defaultPermissionProfileId: "root",
    trigger: {
      includeGlobs: [""],
      excludeGlobs: "oops",
      pathPrefixes: [],
      symbolHints: [12],
      minConfidence: 2,
      extra: true,
    },
    subLenses: [
      {
        subLensId: "dup",
        title: "ok",
        description: "ok",
        required: true,
        blockingPolicy: "rule_defined",
        trigger: {
          includeGlobs: [],
          excludeGlobs: [],
          pathPrefixes: [],
          symbolHints: [],
          minConfidence: 0.5,
        },
      },
      {
        subLensId: "dup",
        title: "",
        description: "ok",
        required: "false",
        blockingPolicy: "broken",
        trigger: {
          includeGlobs: [],
          excludeGlobs: [],
          pathPrefixes: [],
          symbolHints: [],
          minConfidence: -1,
        },
      },
    ],
    extraKey: true,
  };

  const getIssueState = () => {
    try {
      assertLensDefinition(invalidDefinition);
      throw new Error("Expected assertLensDefinition to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const issues = (error as { issues?: LensContractIssue[] }).issues;
      expect(Array.isArray(issues)).toBe(true);
      return {
        message: (error as Error).message,
        issues: issues ?? [],
      };
    }
  };

  const first = getIssueState();
  const second = getIssueState();

  expect(first.message).toBe(second.message);
  expect(first.issues).toEqual(second.issues);
  expect(first.issues.length).toBeGreaterThan(0);
  expect(isSorted(first.issues)).toBe(true);
  expect(first.message).toContain("Invalid lens definition:");
});

test("assertLensDefinition rejects sparse trigger string lists", () => {
  const sparse = buildLens("consistency-lens", "consistency") as {
    trigger: { includeGlobs: string[] };
  };
  sparse.trigger.includeGlobs = new Array(1) as string[];

  try {
    assertLensDefinition(sparse);
    throw new Error("Expected sparse trigger list to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("trigger.includeGlobs[0]");
  }
});

test("assertLensDefinition rejects sparse subLens arrays", () => {
  const sparse = buildLens("consistency-lens", "consistency") as {
    subLenses: LensDefinition["subLenses"];
  };
  sparse.subLenses = new Array(1) as LensDefinition["subLenses"];

  try {
    assertLensDefinition(sparse);
    throw new Error("Expected sparse subLenses to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("subLenses[0]");
  }
});

test("formatLensContractIssues emits deterministic numbering", () => {
  const formatted = formatLensContractIssues([
    {
      path: "lensId",
      message: "must be a non-empty string",
    },
    {
      path: "subLenses[0].subLensId",
      message: "must be a non-empty string",
    },
  ]);

  expect(formatted).toBe(
    "Invalid lens definition: #1 path=lensId message=must be a non-empty string; #2 path=subLenses[0].subLensId message=must be a non-empty string",
  );
});
