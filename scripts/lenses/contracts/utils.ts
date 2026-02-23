import type { LensContractIssue } from "./types";

export function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function compareNullableText(
  left: string | null,
  right: string | null,
): number {
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

export function compareLensContractIssues(
  left: LensContractIssue,
  right: LensContractIssue,
): number {
  return compareText(left.path, right.path) || compareText(left.message, right.message);
}

export function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort(compareText);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
