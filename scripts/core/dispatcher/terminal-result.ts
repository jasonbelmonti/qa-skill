import type { LensPlan, LensResult } from "../../contracts/artifacts";
import { hashCanonical } from "../../utils/hash";
import { CliError } from "../errors";
import { assertSchema } from "../schema/validate";
import type { TerminalLensResultInput } from "./types";

interface RetryIssue {
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

function compareRetryIssues(left: RetryIssue, right: RetryIssue): number {
  return compareText(left.path, right.path) || compareText(left.message, right.message);
}

function formatRetryIssues(issues: readonly RetryIssue[]): string {
  if (issues.length === 0) {
    return "Lens result identity mismatch with no validation issues reported";
  }

  const details = issues
    .map((issue, index) => `#${index + 1} path=${issue.path} message=${issue.message}`)
    .join("; ");

  return `Lens result identity mismatch: ${details}`;
}

export function assertLensResultIdentity(plan: LensPlan, result: LensResult): void {
  const issues: RetryIssue[] = [];

  if (result.planOrdinal !== plan.planOrdinal) {
    issues.push({
      path: "result.planOrdinal",
      message: `must equal plan.planOrdinal (${plan.planOrdinal})`,
    });
  }
  if (result.lensId !== plan.lensId) {
    issues.push({
      path: "result.lensId",
      message: `must equal plan.lensId (${plan.lensId})`,
    });
  }
  if (result.subLensId !== plan.subLensId) {
    issues.push({
      path: "result.subLensId",
      message: `must equal plan.subLensId (${String(plan.subLensId)})`,
    });
  }
  if (result.lensVersion !== plan.lensVersion) {
    issues.push({
      path: "result.lensVersion",
      message: `must equal plan.lensVersion (${plan.lensVersion})`,
    });
  }

  if (issues.length > 0) {
    throw new CliError(
      "ARTIFACT_SCHEMA_INVALID",
      formatRetryIssues(issues.sort(compareRetryIssues)),
    );
  }
}

export function buildTerminalLensResult(input: TerminalLensResultInput): LensResult {
  const status =
    input.task.plan.required || input.skillInput.runMode === "strict"
      ? "failed"
      : "degraded";

  const fallback: LensResult = {
    schemaVersion: "lens-result.v1",
    planOrdinal: input.task.plan.planOrdinal,
    lensId: input.task.plan.lensId,
    subLensId: input.task.plan.subLensId,
    lensVersion: input.task.plan.lensVersion,
    status,
    degraded: true,
    findings: [],
    evidenceSummary: [
      `dispatcher_terminal_failure code=${input.classification.code} attempts=${input.attemptsUsed} reason=${input.classification.reason}`,
    ],
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
      unavailableReason: input.usageUnavailableReason ?? "ADAPTER_ERROR",
    },
    errorCodes: [input.classification.code],
    warningCodes: [],
    executionAudit: null,
    adapterResponseHash: hashCanonical({
      source: "dispatcher-terminal-fallback",
      planOrdinal: input.task.plan.planOrdinal,
      lensId: input.task.plan.lensId,
      subLensId: input.task.plan.subLensId,
      code: input.classification.code,
      reason: input.classification.reason,
      attemptsUsed: input.attemptsUsed,
    }),
  };

  assertSchema("lens-result.v1", fallback, "ARTIFACT_SCHEMA_INVALID");
  return fallback;
}
