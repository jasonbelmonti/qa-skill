import type { LensPlan } from "../../contracts/artifacts";
import type { OverflowPolicy } from "../../contracts/common";
import type { SkillInput } from "../../contracts/skill-input";
import { LENS_CLASS_PRIORITY, type LensDefinition, type LensSubLensDefinition } from "../../lenses/contracts";
import type { LoadedLensRegistry } from "../../lenses/loader";
import { hashCanonical } from "../../utils/hash";
import { CliError } from "../errors";
import type { ContextBoundsResult } from "../context/types";
import type { ChangeSurfaceFile } from "../git/change-surface-types";
import { assertSchema } from "../schema/validate";
import type {
  BuildLensPlansInput,
  BuildLensPlansResult,
  PlannerDiagnostic,
  PlannerWarningCode,
} from "./types";

interface PlannerIssue {
  path: string;
  message: string;
}

interface EvaluatedSubLens {
  lens: LensDefinition;
  subLens: LensSubLensDefinition;
  score: number;
  minConfidence: number;
  fileMatchSignal: 0 | 0.6;
  prefixSignal: 0 | 0.2;
  symbolSignal: 0 | 0.2;
  matchedFiles: string[];
  selected: boolean;
  broadFallback: boolean;
}

type PatternKind =
  | { kind: "exact"; path: string }
  | { kind: "prefixRecursive"; prefix: string }
  | { kind: "extensionAnyDepth"; extension: string }
  | { kind: "extensionBaseName"; extension: string }
  | { kind: "prefixExtensionAnyDepth"; prefix: string; extension: string }
  | { kind: "unsupported" };

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareNullableText(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return -1;
  }
  if (right === null) {
    return 1;
  }
  return compareText(left, right);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function normalizePrefix(prefix: string): string {
  return normalizePath(prefix.trim()).replace(/\/+$/, "");
}

function comparePlannerIssues(left: PlannerIssue, right: PlannerIssue): number {
  return compareText(left.path, right.path) || compareText(left.message, right.message);
}

function formatPlannerIssues(issues: readonly PlannerIssue[]): string {
  if (issues.length === 0) {
    return "Lens plan build failed with no validation issues reported";
  }

  const details = issues
    .map((issue, index) => `#${index + 1} path=${issue.path} message=${issue.message}`)
    .join("; ");

  return `Lens plan build failed: ${details}`;
}

function resolveSelectedLenses(
  registry: LoadedLensRegistry,
  selectedLensIds: readonly string[],
): LensDefinition[] {
  const issues: PlannerIssue[] = [];

  selectedLensIds.forEach((lensId, index) => {
    if (!Object.prototype.hasOwnProperty.call(registry.lensesById, lensId)) {
      issues.push({
        path: `selectedLensIds[${index}]`,
        message: `unknown lensId (${lensId})`,
      });
      return;
    }

    const lens = registry.lensesById[lensId];
    if (lens.subLenses.length === 0) {
      issues.push({
        path: `selectedLensIds[${index}]`,
        message: `lensId (${lensId}) must define at least one subLens`,
      });
    }
  });

  if (issues.length > 0) {
    throw new CliError(
      "CONFIG_VALIDATION_ERROR",
      formatPlannerIssues(issues.sort(comparePlannerIssues)),
    );
  }

  const selectedLensIdSet = new Set(selectedLensIds);

  return registry.lenses
    .filter((lens) => selectedLensIdSet.has(lens.lensId))
    .sort((left, right) => compareText(left.lensId, right.lensId));
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return -1;
  }
  if (right === null) {
    return 1;
  }
  return compareNumbers(left, right);
}

function compareNumberArrays(left: readonly number[], right: readonly number[]): number {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    const compared = compareNumbers(left[index]!, right[index]!);
    if (compared !== 0) {
      return compared;
    }
  }
  return compareNumbers(left.length, right.length);
}

function resolvePrimaryProviderBinding(skillInput: SkillInput) {
  if (skillInput.providerBindings.length === 0) {
    throw new CliError(
      "CONFIG_VALIDATION_ERROR",
      "Lens plan build failed: providerBindings must contain at least one binding",
    );
  }

  return [...skillInput.providerBindings].sort((left, right) => {
    return (
      compareText(left.bindingId, right.bindingId) ||
      compareText(left.adapterId, right.adapterId) ||
      compareText(left.adapterVersion, right.adapterVersion) ||
      compareText(left.modelId, right.modelId) ||
      compareNumbers(left.maxTokens, right.maxTokens) ||
      compareNumbers(left.timeoutMs, right.timeoutMs) ||
      compareNullableNumbers(left.seed, right.seed) ||
      compareNumbers(left.temperature, right.temperature) ||
      compareNumbers(left.topP, right.topP) ||
      compareNumbers(left.retryMax, right.retryMax) ||
      compareNumberArrays(left.retryBackoffMs, right.retryBackoffMs)
    );
  })[0];
}

function resolvePermissionProfileId(
  skillInput: SkillInput,
  lens: LensDefinition,
): LensPlan["permissionProfileId"] {
  const profileIds = new Set(skillInput.permissionProfiles.map((profile) => profile.profileId));
  if (profileIds.has(lens.defaultPermissionProfileId)) {
    return lens.defaultPermissionProfileId;
  }
  return skillInput.defaultPermissionProfileId;
}

function matchesExtension(target: string, extension: string): boolean {
  const normalizedExtension = extension.replace(/^\.+/, "").toLowerCase();
  if (normalizedExtension.length === 0) {
    return false;
  }

  return target.toLowerCase().endsWith(`.${normalizedExtension}`);
}

function isValidExtensionToken(extension: string): boolean {
  return extension.length > 0 && !extension.includes("*") && !extension.includes("/");
}

function hasNonAsteriskWildcard(pattern: string): boolean {
  return (
    pattern.includes("?") ||
    pattern.includes("[") ||
    pattern.includes("]") ||
    pattern.includes("{") ||
    pattern.includes("}")
  );
}

function classifyPattern(pattern: string): PatternKind {
  const normalizedPattern = normalizePath(pattern.trim());

  if (normalizedPattern.length === 0) {
    return { kind: "unsupported" };
  }

  if (hasNonAsteriskWildcard(normalizedPattern)) {
    return { kind: "unsupported" };
  }

  if (!normalizedPattern.includes("*")) {
    return { kind: "exact", path: normalizedPattern };
  }

  if (normalizedPattern.endsWith("/**")) {
    const rawPrefix = normalizedPattern.slice(0, -3);
    const prefix = normalizePrefix(rawPrefix);
    if (prefix.length > 0 && !rawPrefix.includes("*")) {
      return { kind: "prefixRecursive", prefix };
    }
    return { kind: "unsupported" };
  }

  if (normalizedPattern.startsWith("**/*.")) {
    const extension = normalizedPattern.slice(5);
    if (isValidExtensionToken(extension)) {
      return { kind: "extensionAnyDepth", extension };
    }
    return { kind: "unsupported" };
  }

  if (normalizedPattern.startsWith("*.")) {
    const extension = normalizedPattern.slice(2);
    if (isValidExtensionToken(extension)) {
      return { kind: "extensionBaseName", extension };
    }
    return { kind: "unsupported" };
  }

  const marker = "/**/*.";
  const markerIndex = normalizedPattern.indexOf(marker);
  if (markerIndex > 0 && normalizedPattern.indexOf(marker, markerIndex + 1) === -1) {
    const rawPrefix = normalizedPattern.slice(0, markerIndex);
    const prefix = normalizePrefix(rawPrefix);
    const extension = normalizedPattern.slice(markerIndex + marker.length);
    if (prefix.length > 0 && !rawPrefix.includes("*") && isValidExtensionToken(extension)) {
      return { kind: "prefixExtensionAnyDepth", prefix, extension };
    }
    return { kind: "unsupported" };
  }

  return { kind: "unsupported" };
}

function matchesSupportedPattern(filePath: string, pattern: string): boolean {
  const normalizedPath = normalizePath(filePath);
  const classified = classifyPattern(pattern);

  if (classified.kind === "exact") {
    return normalizedPath === classified.path;
  }

  if (classified.kind === "prefixRecursive") {
    return normalizedPath === classified.prefix || normalizedPath.startsWith(`${classified.prefix}/`);
  }

  if (classified.kind === "extensionAnyDepth") {
    return matchesExtension(normalizedPath, classified.extension);
  }

  if (classified.kind === "extensionBaseName") {
    const fileName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
    return matchesExtension(fileName, classified.extension);
  }

  if (classified.kind === "prefixExtensionAnyDepth") {
    return (
      (normalizedPath === classified.prefix || normalizedPath.startsWith(`${classified.prefix}/`)) &&
      matchesExtension(normalizedPath, classified.extension)
    );
  }

  return false;
}

function collectUnsupportedGlobIssues(selectedLenses: readonly LensDefinition[]): PlannerIssue[] {
  const issues: PlannerIssue[] = [];

  for (const lens of selectedLenses) {
    for (const subLens of [...lens.subLenses].sort((left, right) => compareText(left.subLensId, right.subLensId))) {
      const triggerSets = [
        { label: "includeGlobs", values: subLens.trigger.includeGlobs },
        { label: "excludeGlobs", values: subLens.trigger.excludeGlobs },
      ] as const;

      for (const triggerSet of triggerSets) {
        triggerSet.values.forEach((pattern, index) => {
          if (classifyPattern(pattern).kind !== "unsupported") {
            return;
          }

          issues.push({
            path: `lensId=${lens.lensId}.subLensId=${subLens.subLensId}.trigger.${triggerSet.label}[${index}]`,
            message:
              `unsupported wildcard glob (${pattern}); supported forms are exact path, *.ext, **/*.ext, prefix/**, and prefix/**/*.ext`,
          });
        });
      }
    }
  }

  return issues;
}

function matchesPathPrefix(filePath: string, prefix: string): boolean {
  const normalizedPath = normalizePath(filePath);
  const normalizedPrefix = normalizePrefix(prefix);

  if (normalizedPrefix.length === 0) {
    return false;
  }

  return (
    normalizedPath === normalizedPrefix ||
    normalizedPath.startsWith(`${normalizedPrefix}/`)
  );
}

function matchFilesForTrigger(
  selectedContextFiles: readonly string[],
  trigger: LensSubLensDefinition["trigger"],
): string[] {
  const includeGlobs = sortedUnique(trigger.includeGlobs);
  const excludeGlobs = sortedUnique(trigger.excludeGlobs);
  const matched: string[] = [];

  for (const filePath of selectedContextFiles) {
    const includeMatched =
      includeGlobs.length === 0 ||
      includeGlobs.some((glob) => matchesSupportedPattern(filePath, glob));

    if (!includeMatched) {
      continue;
    }

    const excludeMatched = excludeGlobs.some((glob) =>
      matchesSupportedPattern(filePath, glob),
    );
    if (excludeMatched) {
      continue;
    }

    matched.push(filePath);
  }

  return sortedUnique(matched);
}

function hasPrefixSignal(
  candidateFiles: readonly string[],
  pathPrefixes: readonly string[],
): boolean {
  const normalizedPrefixes = sortedUnique(pathPrefixes.map(normalizePrefix)).filter(
    (prefix) => prefix.length > 0,
  );

  if (normalizedPrefixes.length === 0) {
    return false;
  }

  return candidateFiles.some((filePath) =>
    normalizedPrefixes.some((prefix) => matchesPathPrefix(filePath, prefix)),
  );
}

function hasSymbolSignal(
  matchedFiles: readonly string[],
  symbolHints: readonly string[],
  changeSurfaceFileByPath: ReadonlyMap<string, ChangeSurfaceFile>,
): boolean {
  const normalizedHints = new Set(
    symbolHints
      .map((hint) => hint.trim().toLowerCase())
      .filter((hint) => hint.length > 0),
  );

  if (normalizedHints.size === 0) {
    return false;
  }

  for (const filePath of matchedFiles) {
    const file = changeSurfaceFileByPath.get(normalizePath(filePath));
    if (!file) {
      continue;
    }

    for (const symbol of file.symbols) {
      if (normalizedHints.has(symbol.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

function compareDiagnostics(left: PlannerDiagnostic, right: PlannerDiagnostic): number {
  return (
    compareText(left.lensId, right.lensId) ||
    compareText(left.subLensId, right.subLensId) ||
    right.score - left.score ||
    right.matchedFileCount - left.matchedFileCount ||
    compareText(left.matchedFiles.join("|"), right.matchedFiles.join("|"))
  );
}

function comparePlansForQueue(left: LensPlan, right: LensPlan): number {
  if (left.required !== right.required) {
    return left.required ? -1 : 1;
  }

  return (
    LENS_CLASS_PRIORITY[left.lensClass] - LENS_CLASS_PRIORITY[right.lensClass] ||
    compareText(left.lensId, right.lensId) ||
    compareNullableText(left.subLensId, right.subLensId) ||
    compareText(left.scopeDigest, right.scopeDigest)
  );
}

export function sortLensPlansForQueue(lensPlans: readonly LensPlan[]): LensPlan[] {
  return [...lensPlans]
    .sort(comparePlansForQueue)
    .map((plan, index) => ({
      ...plan,
      planOrdinal: index,
    }));
}

function toOverflowPolicy(required: boolean, runMode: SkillInput["runMode"]): OverflowPolicy {
  if (required) {
    return "stop";
  }

  if (runMode === "strict") {
    return "stop";
  }

  return "skip";
}

function evaluateSubLens(
  lens: LensDefinition,
  subLens: LensSubLensDefinition,
  selectedContextFiles: readonly string[],
  changeSurfaceFileByPath: ReadonlyMap<string, ChangeSurfaceFile>,
): EvaluatedSubLens {
  const matchedFiles = matchFilesForTrigger(selectedContextFiles, subLens.trigger);
  const fileMatchSignal: 0 | 0.6 = matchedFiles.length > 0 ? 0.6 : 0;
  const prefixSignal: 0 | 0.2 = hasPrefixSignal(matchedFiles, subLens.trigger.pathPrefixes)
    ? 0.2
    : 0;
  const symbolSignal: 0 | 0.2 = hasSymbolSignal(
    matchedFiles,
    subLens.trigger.symbolHints,
    changeSurfaceFileByPath,
  )
    ? 0.2
    : 0;

  const score = fileMatchSignal + prefixSignal + symbolSignal;
  const selected = score >= subLens.trigger.minConfidence;

  return {
    lens,
    subLens,
    score,
    minConfidence: subLens.trigger.minConfidence,
    fileMatchSignal,
    prefixSignal,
    symbolSignal,
    matchedFiles,
    selected,
    broadFallback: false,
  };
}

function buildScopeDigest(
  lensId: string,
  subLensId: string,
  changedFiles: readonly string[],
  omittedFiles: readonly string[],
): string {
  return hashCanonical({
    lensId,
    subLensId,
    changedFiles,
    fullContextFiles: [],
    omittedFiles,
  });
}

function toDiagnostic(evaluation: EvaluatedSubLens): PlannerDiagnostic {
  return {
    lensId: evaluation.lens.lensId,
    subLensId: evaluation.subLens.subLensId,
    score: evaluation.score,
    minConfidence: evaluation.minConfidence,
    fileMatchSignal: evaluation.fileMatchSignal,
    prefixSignal: evaluation.prefixSignal,
    symbolSignal: evaluation.symbolSignal,
    matchedFileCount: evaluation.matchedFiles.length,
    matchedFiles: [...evaluation.matchedFiles],
    selected: evaluation.selected,
    broadFallback: evaluation.broadFallback,
  };
}

export function buildLensPlans(input: BuildLensPlansInput): BuildLensPlansResult {
  const selectedLenses = resolveSelectedLenses(input.registry, input.selectedLensIds);
  const unsupportedGlobIssues = collectUnsupportedGlobIssues(selectedLenses);
  if (unsupportedGlobIssues.length > 0) {
    throw new CliError(
      "CONFIG_VALIDATION_ERROR",
      formatPlannerIssues(unsupportedGlobIssues.sort(comparePlannerIssues)),
    );
  }
  const primaryBinding = resolvePrimaryProviderBinding(input.skillInput);

  const changeSurfaceFileByPath = new Map<string, ChangeSurfaceFile>();
  const sortedSurfaceFiles = [...input.changeSurface.files].sort((left, right) =>
    compareText(left.filePath, right.filePath),
  );
  for (const file of sortedSurfaceFiles) {
    const key = normalizePath(file.filePath);
    if (!changeSurfaceFileByPath.has(key)) {
      changeSurfaceFileByPath.set(key, file);
    }
  }

  const selectedContextFiles = sortedUnique(input.contextBounds.selectedFiles);
  const omittedFiles = sortedUnique(input.contextBounds.omittedFiles);

  const plans: LensPlan[] = [];
  const diagnostics: PlannerDiagnostic[] = [];
  let broadFallbackUsed = false;

  for (const lens of selectedLenses) {
    const evaluated = [...lens.subLenses]
      .sort((left, right) => compareText(left.subLensId, right.subLensId))
      .map((subLens) =>
        evaluateSubLens(lens, subLens, selectedContextFiles, changeSurfaceFileByPath),
      );

    if (!evaluated.some((item) => item.selected)) {
      broadFallbackUsed = broadFallbackUsed || evaluated.length > 0;
      for (const item of evaluated) {
        item.selected = true;
        item.broadFallback = true;
        item.matchedFiles = [...selectedContextFiles];
      }
    }

    for (const item of evaluated) {
      diagnostics.push(toDiagnostic(item));

      if (!item.selected) {
        continue;
      }

      const required = lens.requiredByDefault || item.subLens.required;
      const changedFiles = sortedUnique(item.matchedFiles);
      const plan: LensPlan = {
        schemaVersion: "lens-plan.v1",
        planOrdinal: 0,
        lensId: lens.lensId,
        subLensId: item.subLens.subLensId,
        lensVersion: lens.lensVersion,
        lensClass: lens.lensClass,
        required,
        blockingPolicy: item.subLens.blockingPolicy,
        providerBindingId: primaryBinding.bindingId,
        permissionProfileId: resolvePermissionProfileId(input.skillInput, lens),
        changedFiles,
        fullContextFiles: [],
        omittedFiles,
        scopeDigest: buildScopeDigest(
          lens.lensId,
          item.subLens.subLensId,
          changedFiles,
          omittedFiles,
        ),
        executionCommands: [],
        maxInputTokens: primaryBinding.maxTokens,
        maxOutputTokens: primaryBinding.maxTokens,
        maxCostUsd: input.skillInput.runBudgetMaxCostUsd,
        overflowPolicy: toOverflowPolicy(required, input.skillInput.runMode),
      };

      plans.push(plan);
    }
  }

  const lensPlans = sortLensPlansForQueue(plans);

  for (const plan of lensPlans) {
    assertSchema("lens-plan.v1", plan, "ARTIFACT_SCHEMA_INVALID");
  }

  const warningCodes: PlannerWarningCode[] = broadFallbackUsed
    ? ["PLAN_CONFIDENCE_LOW_BROAD_SCAN"]
    : [];

  return {
    lensPlans,
    warningCodes,
    diagnostics: [...diagnostics].sort(compareDiagnostics),
  };
}
