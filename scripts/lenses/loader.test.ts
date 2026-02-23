import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CliError } from "../core/errors";
import { loadLensRegistry } from "./loader";

async function withTempDir<T>(fn: (tempDir: string) => Promise<T>): Promise<T> {
  const testDir = await mkdtemp(join(tmpdir(), "qa-skill-lens-loader-"));
  try {
    return await fn(testDir);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildManifest() {
  return {
    schemaVersion: "skill-manifest.v1",
    skillId: "qa-skill",
    skillVersion: "1.0.0",
    name: "qa-skill",
    summary: "Deterministic QA orchestrator manifest.",
    registryPath: "skill/registry.v1.json",
    defaultRunMode: "strict",
    supportedLensClasses: ["consistency", "style"],
    deterministicOrdering: {
      lenses: "lensId ASC",
      subLenses: "subLensId ASC",
    },
  };
}

function buildRegistry() {
  return {
    schemaVersion: "skill-registry.v1",
    skillId: "qa-skill",
    skillVersion: "1.0.0",
    orderingRules: {
      lenses: "lensId ASC",
      subLenses: "subLensId ASC",
    },
    lenses: [
      {
        lensId: "style-core",
        lensVersion: "1.0.0",
        lensClass: "style",
        title: "Style Core",
        description: "Style checks.",
        requiredByDefault: false,
        defaultPermissionProfileId: "read_only",
        trigger: {
          includeGlobs: ["**/*.tsx", "**/*.ts"],
          excludeGlobs: [],
          pathPrefixes: ["src/", "scripts/"],
          symbolHints: ["format", "style"],
          minConfidence: 0.2,
        },
        subLenses: [
          {
            subLensId: "typescript-formatting",
            title: "TypeScript Formatting",
            description: "Formatting checks.",
            required: false,
            blockingPolicy: "mixed",
            trigger: {
              includeGlobs: ["**/*.tsx", "**/*.ts"],
              excludeGlobs: [],
              pathPrefixes: ["scripts/", "src/"],
              symbolHints: ["imports", "format"],
              minConfidence: 0.3,
            },
          },
          {
            subLensId: "css-naming",
            title: "CSS Naming",
            description: "Naming checks.",
            required: false,
            blockingPolicy: "severity_threshold",
            trigger: {
              includeGlobs: ["**/*.css"],
              excludeGlobs: [],
              pathPrefixes: ["src/"],
              symbolHints: ["className"],
              minConfidence: 0.25,
            },
          },
        ],
      },
      {
        lensId: "consistency-core",
        lensVersion: "1.0.0",
        lensClass: "consistency",
        title: "Consistency Core",
        description: "Consistency checks.",
        requiredByDefault: true,
        defaultPermissionProfileId: "read_only",
        trigger: {
          includeGlobs: ["**/*.tsx", "**/*.ts"],
          excludeGlobs: [],
          pathPrefixes: ["src/", "scripts/"],
          symbolHints: ["deterministic", "lens"],
          minConfidence: 0.6,
        },
        subLenses: [
          {
            subLensId: "style-guides",
            title: "Style Guides",
            description: "Guideline checks.",
            required: false,
            blockingPolicy: "rule_defined",
            trigger: {
              includeGlobs: ["**/*.tsx", "**/*.ts"],
              excludeGlobs: [],
              pathPrefixes: ["scripts/", "src/"],
              symbolHints: ["style", "guide"],
              minConfidence: 0.4,
            },
          },
          {
            subLensId: "architecture-drift",
            title: "Architecture Drift",
            description: "Architecture checks.",
            required: true,
            blockingPolicy: "rule_defined",
            trigger: {
              includeGlobs: ["**/*.tsx", "**/*.ts"],
              excludeGlobs: [],
              pathPrefixes: ["scripts/", "src/"],
              symbolHints: ["orchestrator", "dispatcher"],
              minConfidence: 0.7,
            },
          },
        ],
      },
    ],
  };
}

async function writeSkillFiles(
  repoRoot: string,
  manifest: unknown,
  registry: unknown,
): Promise<void> {
  const skillDir = join(repoRoot, "skill");
  await mkdir(skillDir, { recursive: true });
  await writeJsonFile(join(skillDir, "manifest.v1.json"), manifest);
  await writeJsonFile(join(skillDir, "registry.v1.json"), registry);
}

test("loadLensRegistry validates and normalizes deterministic lens ordering", async () => {
  await withTempDir(async (repoRoot) => {
    await writeSkillFiles(repoRoot, buildManifest(), buildRegistry());

    const first = await loadLensRegistry({ repoRoot });
    const second = await loadLensRegistry({ repoRoot });

    expect(first).toEqual(second);
    expect(first.lenses.map((lens) => lens.lensId)).toEqual([
      "consistency-core",
      "style-core",
    ]);
    expect(first.lenses[0].subLenses.map((subLens) => subLens.subLensId)).toEqual([
      "architecture-drift",
      "style-guides",
    ]);
    expect(first.lenses[1].subLenses.map((subLens) => subLens.subLensId)).toEqual([
      "css-naming",
      "typescript-formatting",
    ]);
    expect(Object.keys(first.lensesById)).toEqual([
      "consistency-core",
      "style-core",
    ]);
  });
});

test("loadLensRegistry keeps lensesById safe for prototype-like lens ids", async () => {
  await withTempDir(async (repoRoot) => {
    const registry = buildRegistry();
    registry.lenses[0].lensId = "__proto__";
    await writeSkillFiles(repoRoot, buildManifest(), registry);

    const loaded = await loadLensRegistry({ repoRoot });

    expect(Object.getPrototypeOf(loaded.lensesById)).toBeNull();
    expect(Object.keys(loaded.lensesById)).toEqual([
      "__proto__",
      "consistency-core",
    ]);
    expect(loaded.lensesById["__proto__"]?.title).toBe("Style Core");
  });
});

test("loadLensRegistry rejects duplicate lens ids with deterministic issue output", async () => {
  await withTempDir(async (repoRoot) => {
    const registry = buildRegistry();
    registry.lenses[1].lensId = "style-core";
    await writeSkillFiles(repoRoot, buildManifest(), registry);

    const capture = async () => {
      try {
        await loadLensRegistry({ repoRoot });
        throw new Error("Expected loadLensRegistry to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        const cliError = error as CliError;
        expect(cliError.code).toBe("ARTIFACT_SCHEMA_INVALID");
        return cliError.message;
      }
    };

    const first = await capture();
    const second = await capture();

    expect(first).toBe(second);
    expect(first).toContain("duplicate lensId");
    expect(first).toContain("lenses[1].lensId");
  });
});

test("loadLensRegistry rejects schema-invalid manifest payload deterministically", async () => {
  await withTempDir(async (repoRoot) => {
    const manifest = buildManifest() as Record<string, unknown>;
    manifest.schemaVersion = "skill-input.v1";
    await writeSkillFiles(repoRoot, manifest, buildRegistry());

    const capture = async () => {
      try {
        await loadLensRegistry({ repoRoot });
        throw new Error("Expected loadLensRegistry to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        const cliError = error as CliError;
        expect(cliError.code).toBe("ARTIFACT_SCHEMA_INVALID");
        return cliError.message;
      }
    };

    const first = await capture();
    const second = await capture();

    expect(first).toBe(second);
    expect(first).toContain("Expected schemaVersion skill-manifest.v1");
  });
});

test("loadLensRegistry rejects non-json registry files deterministically", async () => {
  await withTempDir(async (repoRoot) => {
    const skillDir = join(repoRoot, "skill");
    await mkdir(skillDir, { recursive: true });
    await writeJsonFile(join(skillDir, "manifest.v1.json"), buildManifest());
    await writeFile(join(skillDir, "registry.v1.json"), "{\n", "utf8");

    try {
      await loadLensRegistry({ repoRoot });
      throw new Error("Expected loadLensRegistry to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cliError = error as CliError;
      expect(cliError.code).toBe("ARTIFACT_SCHEMA_INVALID");
      expect(cliError.message).toContain("Skill registry is not valid JSON");
    }
  });
});
