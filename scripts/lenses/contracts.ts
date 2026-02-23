import type {
  BlockingPolicy,
  LensClass,
  PermissionProfileId,
} from "../contracts/common";

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

const LENS_CLASSES: readonly LensClass[] = [
  "consistency",
  "security",
  "architecture",
  "style",
  "performance",
];

const PERMISSION_PROFILE_IDS: readonly PermissionProfileId[] = [
  "read_only",
  "exec_sandboxed",
  "exec_sandboxed_network_off",
];

const BLOCKING_POLICIES: readonly BlockingPolicy[] = [
  "rule_defined",
  "severity_threshold",
  "mixed",
];

export const LENS_CLASS_PRIORITY: Readonly<Record<LensClass, number>> = {
  consistency: 0,
  security: 1,
  architecture: 2,
  style: 3,
  performance: 4,
};

export interface LensTriggerMetadata {
  includeGlobs: string[];
  excludeGlobs: string[];
  pathPrefixes: string[];
  symbolHints: string[];
  minConfidence: number;
}

export interface LensSubLensDefinition {
  subLensId: string;
  title: string;
  description: string;
  required: boolean;
  blockingPolicy: BlockingPolicy;
  trigger: LensTriggerMetadata;
}

export interface LensDefinition {
  lensId: string;
  lensVersion: string;
  lensClass: LensClass;
  title: string;
  description: string;
  requiredByDefault: boolean;
  defaultPermissionProfileId: PermissionProfileId;
  trigger: LensTriggerMetadata;
  subLenses: LensSubLensDefinition[];
}

export interface LensIdentity {
  lensId: string;
  subLensId: string | null;
  lensVersion: string;
  lensClass: LensClass;
}

export interface LensContractIssue {
  path: string;
  message: string;
}

export class LensContractError extends Error {
  readonly issues: readonly LensContractIssue[];

  constructor(issues: readonly LensContractIssue[]) {
    super(formatLensContractIssues(issues));
    this.issues = issues;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareIssues(left: LensContractIssue, right: LensContractIssue): number {
  return compareText(left.path, right.path) || compareText(left.message, right.message);
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort(compareText);
}

function validateStringList(
  value: unknown,
  path: string,
  issues: LensContractIssue[],
): string[] | null {
  if (!Array.isArray(value)) {
    issues.push({
      path,
      message: "must be an array of non-empty strings",
    });
    return null;
  }

  const collected: string[] = [];
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isNonEmptyString(entry)) {
      issues.push({
        path: entryPath,
        message: "must be a non-empty string",
      });
      return;
    }
    collected.push(entry);
  });

  return collected;
}

function validateTrigger(
  value: unknown,
  path: string,
  issues: LensContractIssue[],
): LensTriggerMetadata | null {
  if (!isPlainObject(value)) {
    issues.push({
      path,
      message: "must be an object",
    });
    return null;
  }

  const allowedKeys = new Set([
    "includeGlobs",
    "excludeGlobs",
    "pathPrefixes",
    "symbolHints",
    "minConfidence",
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        message: "is not an allowed trigger key",
      });
    }
  }

  const includeGlobs = validateStringList(value.includeGlobs, `${path}.includeGlobs`, issues);
  const excludeGlobs = validateStringList(value.excludeGlobs, `${path}.excludeGlobs`, issues);
  const pathPrefixes = validateStringList(value.pathPrefixes, `${path}.pathPrefixes`, issues);
  const symbolHints = validateStringList(value.symbolHints, `${path}.symbolHints`, issues);

  const minConfidencePath = `${path}.minConfidence`;
  const minConfidenceRaw = value.minConfidence;
  if (
    typeof minConfidenceRaw !== "number" ||
    !Number.isFinite(minConfidenceRaw) ||
    minConfidenceRaw < 0 ||
    minConfidenceRaw > 1
  ) {
    issues.push({
      path: minConfidencePath,
      message: "must be a finite number between 0 and 1",
    });
  }

  if (
    includeGlobs === null ||
    excludeGlobs === null ||
    pathPrefixes === null ||
    symbolHints === null ||
    typeof minConfidenceRaw !== "number" ||
    !Number.isFinite(minConfidenceRaw) ||
    minConfidenceRaw < 0 ||
    minConfidenceRaw > 1
  ) {
    return null;
  }

  return {
    includeGlobs,
    excludeGlobs,
    pathPrefixes,
    symbolHints,
    minConfidence: minConfidenceRaw,
  };
}

function validateSubLens(
  value: unknown,
  path: string,
  issues: LensContractIssue[],
): LensSubLensDefinition | null {
  if (!isPlainObject(value)) {
    issues.push({
      path,
      message: "must be an object",
    });
    return null;
  }

  const allowedKeys = new Set([
    "subLensId",
    "title",
    "description",
    "required",
    "blockingPolicy",
    "trigger",
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        message: "is not an allowed sub-lens key",
      });
    }
  }

  const subLensId = value.subLensId;
  if (!isNonEmptyString(subLensId)) {
    issues.push({
      path: `${path}.subLensId`,
      message: "must be a non-empty string",
    });
  }

  const title = value.title;
  if (!isNonEmptyString(title)) {
    issues.push({
      path: `${path}.title`,
      message: "must be a non-empty string",
    });
  }

  const description = value.description;
  if (!isNonEmptyString(description)) {
    issues.push({
      path: `${path}.description`,
      message: "must be a non-empty string",
    });
  }

  const required = value.required;
  if (typeof required !== "boolean") {
    issues.push({
      path: `${path}.required`,
      message: "must be a boolean",
    });
  }

  const blockingPolicy = value.blockingPolicy;
  if (!BLOCKING_POLICIES.includes(blockingPolicy as BlockingPolicy)) {
    issues.push({
      path: `${path}.blockingPolicy`,
      message: `must be one of: ${BLOCKING_POLICIES.join(", ")}`,
    });
  }

  const trigger = validateTrigger(value.trigger, `${path}.trigger`, issues);

  if (
    !isNonEmptyString(subLensId) ||
    !isNonEmptyString(title) ||
    !isNonEmptyString(description) ||
    typeof required !== "boolean" ||
    !BLOCKING_POLICIES.includes(blockingPolicy as BlockingPolicy) ||
    trigger === null
  ) {
    return null;
  }

  return {
    subLensId,
    title,
    description,
    required,
    blockingPolicy: blockingPolicy as BlockingPolicy,
    trigger,
  };
}

export function compareLensClass(left: LensClass, right: LensClass): number {
  return LENS_CLASS_PRIORITY[left] - LENS_CLASS_PRIORITY[right];
}

export function compareLensIdentity(left: LensIdentity, right: LensIdentity): number {
  return (
    compareLensClass(left.lensClass, right.lensClass) ||
    compareText(left.lensId, right.lensId) ||
    compareNullableText(left.subLensId, right.subLensId) ||
    compareText(left.lensVersion, right.lensVersion)
  );
}

export function compareSubLensDefinitions(
  left: LensSubLensDefinition,
  right: LensSubLensDefinition,
): number {
  return compareText(left.subLensId, right.subLensId);
}

export function compareLensDefinitions(
  left: LensDefinition,
  right: LensDefinition,
): number {
  return (
    compareLensClass(left.lensClass, right.lensClass) ||
    compareText(left.lensId, right.lensId) ||
    compareText(left.lensVersion, right.lensVersion)
  );
}

export function toLensIdentity(
  lensDefinition: Pick<LensDefinition, "lensId" | "lensVersion" | "lensClass">,
  subLens: Pick<LensSubLensDefinition, "subLensId"> | null = null,
): LensIdentity {
  return {
    lensId: lensDefinition.lensId,
    subLensId: subLens?.subLensId ?? null,
    lensVersion: lensDefinition.lensVersion,
    lensClass: lensDefinition.lensClass,
  };
}

export function normalizeLensTriggerMetadata(
  trigger: LensTriggerMetadata,
): LensTriggerMetadata {
  return {
    includeGlobs: sortedStrings(trigger.includeGlobs),
    excludeGlobs: sortedStrings(trigger.excludeGlobs),
    pathPrefixes: sortedStrings(trigger.pathPrefixes),
    symbolHints: sortedStrings(trigger.symbolHints),
    minConfidence: trigger.minConfidence,
  };
}

export function normalizeSubLensDefinition(
  subLens: LensSubLensDefinition,
): LensSubLensDefinition {
  return {
    ...subLens,
    trigger: normalizeLensTriggerMetadata(subLens.trigger),
  };
}

export function normalizeLensDefinition(lens: LensDefinition): LensDefinition {
  return {
    ...lens,
    trigger: normalizeLensTriggerMetadata(lens.trigger),
    subLenses: lens.subLenses
      .map(normalizeSubLensDefinition)
      .sort(compareSubLensDefinitions),
  };
}

export function normalizeLensDefinitions(
  lenses: readonly LensDefinition[],
): LensDefinition[] {
  return lenses.map(normalizeLensDefinition).sort(compareLensDefinitions);
}

export function validateLensDefinition(value: unknown): LensContractIssue[] {
  const issues: LensContractIssue[] = [];

  if (!isPlainObject(value)) {
    issues.push({
      path: "/",
      message: "Lens definition must be an object",
    });
    return issues;
  }

  const allowedKeys = new Set([
    "lensId",
    "lensVersion",
    "lensClass",
    "title",
    "description",
    "requiredByDefault",
    "defaultPermissionProfileId",
    "trigger",
    "subLenses",
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: key,
        message: "is not an allowed lens key",
      });
    }
  }

  const lensId = value.lensId;
  if (!isNonEmptyString(lensId)) {
    issues.push({
      path: "lensId",
      message: "must be a non-empty string",
    });
  }

  const lensVersion = value.lensVersion;
  if (!isNonEmptyString(lensVersion)) {
    issues.push({
      path: "lensVersion",
      message: "must be a non-empty string",
    });
  }

  const lensClass = value.lensClass;
  if (!LENS_CLASSES.includes(lensClass as LensClass)) {
    issues.push({
      path: "lensClass",
      message: `must be one of: ${LENS_CLASSES.join(", ")}`,
    });
  }

  const title = value.title;
  if (!isNonEmptyString(title)) {
    issues.push({
      path: "title",
      message: "must be a non-empty string",
    });
  }

  const description = value.description;
  if (!isNonEmptyString(description)) {
    issues.push({
      path: "description",
      message: "must be a non-empty string",
    });
  }

  const requiredByDefault = value.requiredByDefault;
  if (typeof requiredByDefault !== "boolean") {
    issues.push({
      path: "requiredByDefault",
      message: "must be a boolean",
    });
  }

  const defaultPermissionProfileId = value.defaultPermissionProfileId;
  if (
    !PERMISSION_PROFILE_IDS.includes(
      defaultPermissionProfileId as PermissionProfileId,
    )
  ) {
    issues.push({
      path: "defaultPermissionProfileId",
      message: `must be one of: ${PERMISSION_PROFILE_IDS.join(", ")}`,
    });
  }

  validateTrigger(value.trigger, "trigger", issues);

  if (!Array.isArray(value.subLenses)) {
    issues.push({
      path: "subLenses",
      message: "must be an array",
    });
  } else {
    const subLensIdSeen = new Set<string>();
    value.subLenses.forEach((subLens, index) => {
      const subLensPath = `subLenses[${index}]`;
      const parsed = validateSubLens(subLens, subLensPath, issues);
      if (!parsed) {
        return;
      }
      if (subLensIdSeen.has(parsed.subLensId)) {
        issues.push({
          path: subLensPath,
          message: `duplicate subLensId: ${parsed.subLensId}`,
        });
        return;
      }
      subLensIdSeen.add(parsed.subLensId);
    });
  }

  return issues.sort(compareIssues);
}

export function formatLensContractIssues(
  issues: readonly LensContractIssue[],
): string {
  if (issues.length === 0) {
    return "Lens definition is invalid with no validation issues";
  }

  const detail = issues
    .map((issue, index) => `#${index + 1} path=${issue.path} message=${issue.message}`)
    .join("; ");

  return `Invalid lens definition: ${detail}`;
}

export function assertLensDefinition(
  value: unknown,
): asserts value is LensDefinition {
  const issues = validateLensDefinition(value);
  if (issues.length > 0) {
    throw new LensContractError(issues);
  }
}
