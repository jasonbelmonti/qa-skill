import { CliError } from "../core/errors";
import type { LensDefinition } from "./contracts";
import type { LoadedLensRegistry } from "./loader";

interface ResolverIssue {
  path: string;
  message: string;
}

export interface ResolveRequestedLensIdsResult {
  selectedLensIds: string[];
  selectedLenses: LensDefinition[];
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

function compareResolverIssues(left: ResolverIssue, right: ResolverIssue): number {
  return compareText(left.path, right.path) || compareText(left.message, right.message);
}

function formatResolverIssues(issues: readonly ResolverIssue[]): string {
  if (issues.length === 0) {
    return "Requested lens resolution failed with no validation issues reported";
  }

  const details = issues
    .map((issue, index) => `#${index + 1} path=${issue.path} message=${issue.message}`)
    .join("; ");

  return `Requested lens resolution failed: ${details}`;
}

function normalizeSelection(
  lenses: readonly LensDefinition[],
): ResolveRequestedLensIdsResult {
  const selectedLenses = [...lenses];
  return {
    selectedLensIds: selectedLenses.map((lens) => lens.lensId),
    selectedLenses,
  };
}

export function resolveRequestedLensIds(
  registry: LoadedLensRegistry,
  requestedLensIds: readonly string[] | null,
): ResolveRequestedLensIdsResult {
  if (requestedLensIds === null) {
    return normalizeSelection(registry.lenses);
  }

  const issues: ResolverIssue[] = [];
  const requestedToIndex = new Map<string, number>();

  requestedLensIds.forEach((lensId, index) => {
    const path = `requestedLensIds[${index}]`;

    if (requestedToIndex.has(lensId)) {
      const firstIndex = requestedToIndex.get(lensId);
      issues.push({
        path,
        message:
          `duplicate lensId (${lensId}) also present at requestedLensIds[${firstIndex}]`,
      });
      return;
    }

    requestedToIndex.set(lensId, index);

    if (!Object.prototype.hasOwnProperty.call(registry.lensesById, lensId)) {
      issues.push({
        path,
        message: `unknown lensId (${lensId})`,
      });
    }
  });

  if (issues.length > 0) {
    throw new CliError(
      "CONFIG_VALIDATION_ERROR",
      formatResolverIssues(issues.sort(compareResolverIssues)),
    );
  }

  const selectedLenses = registry.lenses.filter((lens) =>
    requestedToIndex.has(lens.lensId),
  );

  return {
    selectedLensIds: selectedLenses.map((lens) => lens.lensId),
    selectedLenses,
  };
}
