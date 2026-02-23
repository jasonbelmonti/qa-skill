import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { LensClass } from "../contracts/common";
import { CliError } from "../core/errors";
import { assertVersionedSchema } from "../core/schema/versioned";
import {
  assertLensDefinition,
  compareSubLensDefinitions,
  normalizeLensTriggerMetadata,
  normalizeSubLensDefinition,
  type LensContractIssue,
  type LensDefinition,
} from "./contracts";

const DEFAULT_MANIFEST_PATH = "skill/manifest.v1.json";

interface OrderingRules {
  lenses: "lensId ASC";
  subLenses: "subLensId ASC";
}

export interface SkillManifestV1 {
  schemaVersion: "skill-manifest.v1";
  skillId: string;
  skillVersion: string;
  name: string;
  summary: string;
  registryPath: string;
  defaultRunMode: "strict" | "best_effort";
  supportedLensClasses: LensClass[];
  deterministicOrdering: OrderingRules;
}

export interface SkillRegistryV1 {
  schemaVersion: "skill-registry.v1";
  skillId: string;
  skillVersion: string;
  orderingRules: OrderingRules;
  lenses: LensDefinition[];
}

export interface LoadedLensRegistry {
  manifestPath: string;
  registryPath: string;
  manifest: SkillManifestV1;
  registry: SkillRegistryV1;
  lenses: LensDefinition[];
  lensesById: Record<string, LensDefinition>;
}

export interface LoadLensRegistryOptions {
  repoRoot?: string;
  manifestPath?: string;
  readTextFile?: (path: string) => Promise<string>;
}

interface LoaderIssue {
  path: string;
  message: string;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareLoaderIssues(left: LoaderIssue, right: LoaderIssue): number {
  return compareText(left.path, right.path) || compareText(left.message, right.message);
}

function compareLensByRegistryRules(left: LensDefinition, right: LensDefinition): number {
  return compareText(left.lensId, right.lensId) || compareText(left.lensVersion, right.lensVersion);
}

function formatLoaderIssues(issues: readonly LoaderIssue[]): string {
  if (issues.length === 0) {
    return "Skill registry validation failed with no validation issues reported";
  }

  const details = issues
    .map((issue, index) => `#${index + 1} path=${issue.path} message=${issue.message}`)
    .join("; ");

  return `Skill registry validation failed: ${details}`;
}

async function readJsonFile(
  path: string,
  label: string,
  readTextFile: (filePath: string) => Promise<string>,
): Promise<unknown> {
  let raw: string;
  try {
    raw = await readTextFile(path);
  } catch {
    throw new CliError("ARTIFACT_SCHEMA_INVALID", `Unable to read ${label}: ${path}`);
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new CliError("ARTIFACT_SCHEMA_INVALID", `${label} is not valid JSON: ${path}`);
  }
}

function normalizeRegistryLenses(lenses: readonly LensDefinition[]): LensDefinition[] {
  return [...lenses]
    .map((lens) => ({
      ...lens,
      trigger: normalizeLensTriggerMetadata(lens.trigger),
      subLenses: lens.subLenses
        .map(normalizeSubLensDefinition)
        .sort(compareSubLensDefinitions),
    }))
    .sort(compareLensByRegistryRules);
}

function collectCrossValidationIssues(
  manifest: SkillManifestV1,
  registry: SkillRegistryV1,
): LoaderIssue[] {
  const issues: LoaderIssue[] = [];

  if (manifest.skillId !== registry.skillId) {
    issues.push({
      path: "skillId",
      message: `manifest (${manifest.skillId}) must match registry (${registry.skillId})`,
    });
  }

  if (manifest.skillVersion !== registry.skillVersion) {
    issues.push({
      path: "skillVersion",
      message: `manifest (${manifest.skillVersion}) must match registry (${registry.skillVersion})`,
    });
  }

  if (manifest.deterministicOrdering.lenses !== registry.orderingRules.lenses) {
    issues.push({
      path: "orderingRules.lenses",
      message:
        `registry (${registry.orderingRules.lenses}) must match manifest deterministic ordering (${manifest.deterministicOrdering.lenses})`,
    });
  }

  if (manifest.deterministicOrdering.subLenses !== registry.orderingRules.subLenses) {
    issues.push({
      path: "orderingRules.subLenses",
      message:
        `registry (${registry.orderingRules.subLenses}) must match manifest deterministic ordering (${manifest.deterministicOrdering.subLenses})`,
    });
  }

  const lensIdToIndex = new Map<string, number>();
  registry.lenses.forEach((lens, index) => {
    const lensPath = `lenses[${index}]`;

    if (lensIdToIndex.has(lens.lensId)) {
      const firstIndex = lensIdToIndex.get(lens.lensId);
      issues.push({
        path: `${lensPath}.lensId`,
        message: `duplicate lensId (${lens.lensId}) also present at lenses[${firstIndex}]`,
      });
    } else {
      lensIdToIndex.set(lens.lensId, index);
    }

    if (!manifest.supportedLensClasses.includes(lens.lensClass)) {
      issues.push({
        path: `${lensPath}.lensClass`,
        message: `lensClass (${lens.lensClass}) is not listed in manifest supportedLensClasses`,
      });
    }

    try {
      assertLensDefinition(lens);
    } catch (error) {
      const contractIssues = (error as { issues?: LensContractIssue[] }).issues;
      if (!Array.isArray(contractIssues) || contractIssues.length === 0) {
        issues.push({
          path: lensPath,
          message: "lens definition is invalid",
        });
        return;
      }

      for (const contractIssue of contractIssues) {
        issues.push({
          path: `${lensPath}.${contractIssue.path}`,
          message: contractIssue.message,
        });
      }
    }
  });

  return issues.sort(compareLoaderIssues);
}

export async function loadLensRegistry(
  options: LoadLensRegistryOptions = {},
): Promise<LoadedLensRegistry> {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const manifestPath = resolve(repoRoot, options.manifestPath ?? DEFAULT_MANIFEST_PATH);
  const readTextFile =
    options.readTextFile ??
    (async (filePath: string): Promise<string> => readFile(filePath, "utf8"));

  const manifestRaw = await readJsonFile(manifestPath, "Skill manifest", readTextFile);
  assertVersionedSchema(
    manifestRaw,
    "ARTIFACT_SCHEMA_INVALID",
    "skill-manifest.v1",
  );
  const manifest = manifestRaw as SkillManifestV1;

  const registryPath = resolve(repoRoot, manifest.registryPath);
  const registryRaw = await readJsonFile(registryPath, "Skill registry", readTextFile);
  assertVersionedSchema(
    registryRaw,
    "ARTIFACT_SCHEMA_INVALID",
    "skill-registry.v1",
  );
  const registry = registryRaw as SkillRegistryV1;

  const issues = collectCrossValidationIssues(manifest, registry);
  if (issues.length > 0) {
    throw new CliError("ARTIFACT_SCHEMA_INVALID", formatLoaderIssues(issues));
  }

  const normalizedLenses = normalizeRegistryLenses(registry.lenses);
  const normalizedRegistry: SkillRegistryV1 = {
    ...registry,
    lenses: normalizedLenses,
  };

  const lensesById = normalizedLenses.reduce(
    (accumulator, lens) => {
      accumulator[lens.lensId] = lens;
      return accumulator;
    },
    {} as Record<string, LensDefinition>,
  );

  return {
    manifestPath,
    registryPath,
    manifest,
    registry: normalizedRegistry,
    lenses: normalizedLenses,
    lensesById,
  };
}
