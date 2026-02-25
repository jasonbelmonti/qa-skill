import type { LensPlan } from "../../contracts/artifacts";
import type { ProviderBinding, SkillInput } from "../../contracts/skill-input";
import { CliError } from "../errors";
import { assertSchema } from "../schema/validate";
import type {
  BuildDispatcherPreflightInput,
  BuildDispatcherPreflightResult,
} from "./types";

interface PreflightIssue {
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

function compareNumbers(left: number, right: number): number {
  return left - right;
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

function compareStringArrays(left: readonly string[], right: readonly string[]): number {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    const compared = compareText(left[index]!, right[index]!);
    if (compared !== 0) {
      return compared;
    }
  }
  return compareNumbers(left.length, right.length);
}

function comparePreflightIssue(left: PreflightIssue, right: PreflightIssue): number {
  return compareText(left.path, right.path) || compareText(left.message, right.message);
}

function formatPreflightIssues(issues: readonly PreflightIssue[]): string {
  if (issues.length === 0) {
    return "Dispatcher preflight failed with no validation issues reported";
  }

  const details = issues
    .map((issue, index) => `#${index + 1} path=${issue.path} message=${issue.message}`)
    .join("; ");

  return `Dispatcher preflight failed: ${details}`;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function compareExecutionCommands(
  left: LensPlan["executionCommands"][number],
  right: LensPlan["executionCommands"][number],
): number {
  return (
    compareNumbers(left.ordinal, right.ordinal) ||
    compareText(left.cwdMode, right.cwdMode) ||
    compareText(left.purpose, right.purpose) ||
    compareStringArrays(left.command, right.command)
  );
}

function normalizeExecutionCommands(
  executionCommands: readonly LensPlan["executionCommands"][number][],
): LensPlan["executionCommands"] {
  return [...executionCommands]
    .map((command) => ({
      ...command,
      command: [...command.command],
    }))
    .sort(compareExecutionCommands);
}

function normalizeLensPlan(plan: LensPlan): LensPlan {
  return {
    ...plan,
    changedFiles: sortedUnique(plan.changedFiles),
    fullContextFiles: sortedUnique(plan.fullContextFiles),
    omittedFiles: sortedUnique(plan.omittedFiles),
    executionCommands: normalizeExecutionCommands(plan.executionCommands),
  };
}

function compareProviderBindings(left: ProviderBinding, right: ProviderBinding): number {
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
}

function compareLensPlansForDispatch(left: LensPlan, right: LensPlan): number {
  return (
    compareNumbers(left.planOrdinal, right.planOrdinal) ||
    compareText(left.lensId, right.lensId) ||
    compareNullableText(left.subLensId, right.subLensId) ||
    compareText(left.scopeDigest, right.scopeDigest) ||
    compareText(left.providerBindingId, right.providerBindingId) ||
    compareText(left.permissionProfileId, right.permissionProfileId) ||
    compareStringArrays(left.changedFiles, right.changedFiles) ||
    compareStringArrays(left.omittedFiles, right.omittedFiles)
  );
}

function validateNoDuplicatePlanOrdinals(lensPlans: readonly LensPlan[]): void {
  const firstIndexByOrdinal = new Map<number, number>();
  const issues: PreflightIssue[] = [];

  lensPlans.forEach((plan, index) => {
    const firstIndex = firstIndexByOrdinal.get(plan.planOrdinal);
    if (firstIndex !== undefined) {
      issues.push({
        path: `lensPlans[${index}].planOrdinal`,
        message: `duplicate planOrdinal (${plan.planOrdinal}) also present at lensPlans[${firstIndex}]`,
      });
      return;
    }

    firstIndexByOrdinal.set(plan.planOrdinal, index);
  });

  if (issues.length > 0) {
    throw new CliError(
      "CONFIG_VALIDATION_ERROR",
      formatPreflightIssues(issues.sort(comparePreflightIssue)),
    );
  }
}

export function resolvePrimaryProviderBinding(skillInput: SkillInput): ProviderBinding {
  if (skillInput.providerBindings.length === 0) {
    throw new CliError(
      "CONFIG_VALIDATION_ERROR",
      formatPreflightIssues([
        {
          path: "skillInput.providerBindings",
          message: "must contain at least one binding",
        },
      ]),
    );
  }

  return [...skillInput.providerBindings].sort(compareProviderBindings)[0]!;
}

export function normalizeLensPlansForDispatch(lensPlans: readonly LensPlan[]): LensPlan[] {
  const normalized = lensPlans.map(normalizeLensPlan);
  return normalized.sort(compareLensPlansForDispatch);
}

export function buildDispatcherPreflight(
  input: BuildDispatcherPreflightInput,
): BuildDispatcherPreflightResult {
  const primaryProviderBinding = resolvePrimaryProviderBinding(input.skillInput);
  const normalizedPlans = normalizeLensPlansForDispatch(input.lensPlans);

  validateNoDuplicatePlanOrdinals(normalizedPlans);

  for (const plan of normalizedPlans) {
    assertSchema("lens-plan.v1", plan, "ARTIFACT_SCHEMA_INVALID");
  }

  return {
    primaryProviderBinding,
    tasks: normalizedPlans.map((plan, queueOrdinal) => ({
      queueOrdinal,
      plan,
    })),
  };
}
