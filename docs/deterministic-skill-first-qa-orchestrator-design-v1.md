# Deterministic Skill-First QA Orchestrator Design (v1)

## Summary
This design defines a Skill-first, diff-driven QA orchestrator implemented in TypeScript under `/scripts`, with pluggable lenses, provider adapters for Claude/Codex-compatible execution, deterministic `PASS|FAIL` semantics, strict schema versioning, deterministic artifacts written to `.qa-skill`, and an explicit opt-in permission model for execution-enabled analyses.

Defaults selected:
- Runtime: Bun-first
- Default run mode: strict
- Artifact root: `.qa-skill`
- Consistency baseline: hybrid bootstrap + human freeze
- Blocking policy: rule-defined
- Execution default: read-only (`read_only` permission profile)

## Module Layout
1. Skill metadata and spec-facing manifest files live at `SKILL.md` and `skill/manifest.v1.json`.
2. Skill registry and lens registration index live at `skill/registry.v1.json`.
3. Orchestrator CLI entrypoint lives at `scripts/cli/run.ts`.
4. Consistency onboarding CLI lives at `scripts/cli/consistency-init.ts`.
5. Drift detection CLI lives at `scripts/cli/drift-check.ts`.
6. Core orchestrator engine lives at `scripts/core/orchestrator.ts`.
7. Diff/base-ref/planning modules live at `scripts/core/git.ts`, `scripts/core/planner.ts`, and `scripts/core/context-builder.ts`.
8. Determinism utilities live at `scripts/core/determinism.ts`.
9. Queue/retry/timeout worker pool lives at `scripts/core/dispatcher.ts`.
10. Provider normalization contracts live at `scripts/providers/types.ts`.
11. OpenAI/Codex adapter lives at `scripts/providers/openai-codex.adapter.ts`.
12. Anthropic/Claude adapter lives at `scripts/providers/anthropic-claude.adapter.ts`.
13. Lens plugin contract + loader live at `scripts/lenses/contracts.ts` and `scripts/lenses/loader.ts`.
14. Consistency lens implementation lives at `scripts/lenses/consistency/index.ts` with rubric files in `scripts/lenses/consistency/rubric/`.
15. Versioned JSON schemas live at `schemas/v1/`.
16. Runtime artifacts are emitted under `.qa-skill/runs/<executionKey>/`.
17. Permission profiles and policy evaluator live at `scripts/security/permissions.ts`.
18. Execution runner and sandbox/worktree manager live at `scripts/core/execution-runner.ts`.
19. Execution audit schema lives at `schemas/v1/execution-audit.v1.json`.

## End-to-End Flow
1. Resolve `baseRef` deterministically in this exact order: configured `baseRef`, `origin/HEAD`, `origin/main`, `origin/master`, else fail with deterministic code.
2. Compute changed files/hunks and classify change surface by file type + symbol heuristics.
3. Select minimal relevant lenses and sub-lenses from registry triggers; fallback to broader scan only when deterministic confidence score is below threshold.
4. Build bounded context packets from diff hunks first; load full-file context only when lens policy requires it.
5. Generate deterministic `LensPlan[]` in stable order and dispatch with fixed concurrency.
6. Evaluate lens permission profile; enforce read-only by default and only allow execution for explicitly allowlisted lens classes plus non-read-only profiles.
7. For execution-enabled plans, run deterministic command specs in sandboxed worktrees and capture execution audit artifacts.
8. Normalize provider and execution responses into `LensResult[]`, map errors to deterministic codes, and preserve stable ordering.
9. Aggregate findings with deterministic conflict resolution and emit `FinalVerdict`.
10. Write versioned artifacts and hashes, then optionally run determinism drift verification.

## Public APIs and Contracts (Strict Types)
```ts
export type SchemaVersion =
  | "skill-input.v1"
  | "skill-result.v1"
  | "lens-plan.v1"
  | "lens-result.v1"
  | "final-verdict.v1"
  | "execution-audit.v1";

export type RunMode = "strict" | "best_effort";
export type VerdictStatus = "PASS" | "FAIL";
export type LensClass = "consistency" | "security" | "architecture" | "style" | "performance";
export type LensStatus = "completed" | "degraded" | "failed" | "skipped";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type PermissionProfileId = "read_only" | "exec_sandboxed" | "exec_sandboxed_network_off";
export type UsageUnavailableReason =
  | "PROVIDER_NOT_SUPPORTED"
  | "MISSING_USAGE_DATA"
  | "ADAPTER_ERROR";

export type ErrorCode =
  | "BASE_REF_CONFIGURED_NOT_FOUND"
  | "BASE_REF_FALLBACK_ORIGIN_HEAD_UNAVAILABLE"
  | "BASE_REF_FALLBACK_ORIGIN_MAIN"
  | "BASE_REF_FALLBACK_ORIGIN_MASTER"
  | "BASE_REF_RESOLUTION_FAILED"
  | "DIFF_TOO_LARGE"
  | "CONTEXT_BOUND_EXCEEDED"
  | "PLAN_CONFIDENCE_LOW_BROAD_SCAN"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_AUTH_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_USAGE_UNAVAILABLE"
  | "EXECUTION_DENIED"
  | "EXECUTION_POLICY_VIOLATION"
  | "EXECUTION_TIMEOUT"
  | "EXECUTION_EXIT_NONZERO"
  | "EXECUTION_AUDIT_UNAVAILABLE"
  | "LENS_REQUIRED_MISSING"
  | "LENS_REQUIRED_FAILED"
  | "BUDGET_RUN_EXCEEDED"
  | "BUDGET_LENS_EXCEEDED"
  | "ARTIFACT_SCHEMA_INVALID"
  | "DETERMINISM_DRIFT_DETECTED";

export interface UsageMetrics {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  unavailableReason: UsageUnavailableReason | null;
}

export interface ProviderBinding {
  bindingId: string;
  adapterId: "openai-codex" | "anthropic-claude";
  adapterVersion: string;
  modelId: string;
  temperature: 0;
  topP: 1;
  maxTokens: number;
  seed: number | null;
  timeoutMs: number;
  retryMax: 2;
  retryBackoffMs: readonly [500, 1500];
}

export interface PermissionProfile {
  profileId: PermissionProfileId;
  readOnly: boolean;
  allowNetwork: boolean;
  worktreeMode: "none" | "ephemeral";
  allowedCommandPrefixes: string[][];
  maxCommandsPerPlan: number;
  commandTimeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

export interface ExecutionCommandSpec {
  ordinal: number;
  command: string[];
  cwdMode: "repo_root" | "ephemeral_worktree";
  purpose: string;
}

export interface ExecutionCommandResult {
  ordinal: number;
  exitCode: number | null;
  timedOut: boolean;
  stdoutSha256: string;
  stderrSha256: string;
}

export interface ExecutionAudit {
  schemaVersion: "execution-audit.v1";
  permissionProfileId: PermissionProfileId;
  worktreePath: string | null;
  commands: ExecutionCommandResult[];
}

export interface SkillInput {
  schemaVersion: "skill-input.v1";
  repoId: string;
  repoRoot: string;
  vcs: "git";
  baseRef: string | null;
  headRef: string;
  runMode: RunMode;
  requestedLensIds: string[] | null;
  maxConcurrency: number;
  allowExecutionLensClasses: LensClass[];
  permissionProfiles: PermissionProfile[];
  defaultPermissionProfileId: PermissionProfileId;
  artifactRoot: string;
  runBudgetMaxTokens: number;
  runBudgetMaxCostUsd: number | null;
  providerBindings: ProviderBinding[];
  configHash: string;
}

export interface LensPlan {
  schemaVersion: "lens-plan.v1";
  planOrdinal: number;
  lensId: string;
  subLensId: string | null;
  lensVersion: string;
  lensClass: LensClass;
  required: boolean;
  blockingPolicy: "rule_defined" | "severity_threshold" | "mixed";
  providerBindingId: string;
  permissionProfileId: PermissionProfileId;
  changedFiles: string[];
  fullContextFiles: string[];
  omittedFiles: string[];
  scopeDigest: string;
  executionCommands: ExecutionCommandSpec[];
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostUsd: number | null;
  overflowPolicy: "stop" | "skip" | "escalate";
}

export interface Finding {
  findingId: string;
  lensId: string;
  subLensId: string | null;
  ruleId: string;
  severity: Severity;
  blocking: boolean;
  file: string;
  startLine: number;
  endLine: number;
  summary: string;
  evidence: Record<string, unknown>;
  evidenceHash: string;
}

export interface LensResult {
  schemaVersion: "lens-result.v1";
  planOrdinal: number;
  lensId: string;
  subLensId: string | null;
  lensVersion: string;
  status: LensStatus;
  degraded: boolean;
  findings: Finding[];
  evidenceSummary: string[];
  usage: UsageMetrics;
  errorCodes: ErrorCode[];
  warningCodes: ErrorCode[];
  executionAudit: ExecutionAudit | null;
  adapterResponseHash: string;
}

export interface FinalVerdict {
  schemaVersion: "final-verdict.v1";
  status: VerdictStatus;
  degraded: boolean;
  rationale: string[];
  requiredLensIds: string[];
  missingRequiredLensIds: string[];
  failedRequiredLensIds: string[];
  blockingFindings: Finding[];
  errorCodes: ErrorCode[];
  aggregateUsage: UsageMetrics;
}

export interface SkillResult {
  schemaVersion: "skill-result.v1";
  executionKey: string;
  normalizedInputHash: string;
  lensPlans: LensPlan[];
  lensResults: LensResult[];
  finalVerdict: FinalVerdict;
}
```

## Determinism Plan
1. Canonical JSON serialization uses sorted object keys and normalized arrays before hashing.
2. Execution key is `sha256(canonicalJson({repoId, baseSha, headSha, selectedLensVersions, providerAdapterVersions, runMode, configHash}))`.
3. Queue order is deterministic: `required DESC`, `lensClassPriority ASC`, `lensId ASC`, `subLensId ASC`, `scopeDigest ASC`.
4. Concurrency is fixed from config, no dynamic worker spawning, no unbounded fan-out.
5. Retries are fixed (`2`) with fixed backoff (`500ms`, `1500ms`) and no jitter.
6. Provider invocation parameters are pinned per binding: exact model id + fixed sampling params.
7. Findings conflict resolution is deterministic: `severity DESC`, `lensId ASC`, `file ASC`, `startLine ASC`, `ruleId ASC`, then `evidenceHash ASC`.
8. Execution command order is deterministic and pinned by `ExecutionCommandSpec.ordinal`; command text cannot be generated dynamically at runtime.
9. Execution environment is deterministic: fixed env allowlist, normalized locale/timezone, fixed working directory policy, and deterministic ephemeral worktree path `.worktrees/qa-skill/<executionKey>/<planOrdinal>/`.
10. Every artifact list is explicitly sorted and schema-versioned.
11. No silent truncation is allowed; omitted context is represented in `omittedFiles` plus `CONTEXT_BOUND_EXCEEDED` warning.
12. Drift detection replays identical normalized input and fails with `DETERMINISM_DRIFT_DETECTED` if any deterministic artifact hash differs.

## PASS/FAIL Semantics
1. `PASS` only when all required lenses are `completed` and there are zero blocking findings.
2. `FAIL` when any blocking finding exists, any required lens is missing/failed, or strict completeness cannot be satisfied.
3. `strict` mode fails when required-scope degradation occurs.
4. `best_effort` mode may pass with `degraded=true` only when degraded scope is non-required and deterministic degradation codes are present.

## Execution and Permission Model
1. Every lens plan gets a `permissionProfileId`; default is always `read_only`.
2. Execution is enabled only when both conditions are true: lens class is listed in `allowExecutionLensClasses` and assigned profile is non-read-only.
3. Permission profiles define deterministic guardrails: network access flag, worktree mode, allowed command prefix list, command count limit, timeout, and output byte bounds.
4. Command specs are authored by lens implementations as static deterministic templates and validated against `allowedCommandPrefixes` before execution.
5. If a command violates profile policy, the run is rejected with `EXECUTION_POLICY_VIOLATION`; no fallback implicit command rewriting is allowed.
6. Execution runs in an ephemeral worktree rooted under `.worktrees/qa-skill/<executionKey>/<planOrdinal>/` and never mutates the primary checkout.
7. All command outputs are hash-recorded in `ExecutionAudit` with per-command exit/timeout status; raw output may be capped but never silently dropped.
8. Execution-related failure codes are deterministic and mode-aware: in `strict`, required execution failure yields `FAIL`; in `best_effort`, optional lens may degrade with explicit codes.

## Consistency Lens Onboarding Model
1. `consistency-init` command builds a deterministic draft rubric from repository architecture signals and representative changed-file exemplars.
2. Draft rubric is written as versioned artifact and is not enforceable until explicit human approval.
3. Approval command freezes `rubricVersion`, `rubricHash`, and `promptTemplateHash`.
4. Runtime always references explicit rubric version; no implicit "latest".
5. Re-runs generate a new draft version; previous versions remain immutable and rerunnable.

## SLOs and Budget Targets
| Diff bucket | Definition | Target p50 | Target p95 |
|---|---|---:|---:|
| Small | `<=20` changed files and `<=800` changed lines | 2.5 min | 5 min |
| Medium | `21-80` changed files or `801-4000` changed lines | 6 min | 12 min |
| Large | `>80` changed files or `>4000` changed lines | 12 min | 20 min |

| Budget scope | Default |
|---|---|
| Run max tokens | 300,000 |
| Run max cost | 12.00 USD (nullable if unavailable) |
| Consistency lens max input tokens | 70,000 |
| Consistency lens max output tokens | 8,000 |
| Overflow policy (required lens, strict) | stop + fail |
| Overflow policy (non-required lens, best_effort) | skip/escalate + degraded |

## Edge Cases and Risk Handling
| Case | Deterministic behavior |
|---|---|
| Huge diffs | Hard cap classification; deterministic file ranking; emit `DIFF_TOO_LARGE` and degrade/fail by mode + requiredness. |
| Provider failures | Normalize to stable error codes; fixed retries/backoff; terminal deterministic failure code. |
| Mixed-success partial runs | Evaluate by requiredness and mode; set `degraded` and deterministic codes as needed. |
| Base-ref fallback failures | Apply strict fallback chain; emit deterministic fallback codes or `BASE_REF_RESOLUTION_FAILED`. |
| Budget exhaustion | Apply class-specific stop/skip/escalate policy with stable codes; never silent truncation. |
| Execution permission mismatch | Reject deterministically with `EXECUTION_DENIED` or `EXECUTION_POLICY_VIOLATION`; never auto-escalate permissions. |
| Execution timeout/non-zero exit | Emit `EXECUTION_TIMEOUT` or `EXECUTION_EXIT_NONZERO` with stable handling by requiredness and mode. |
| Determinism drift | Replay against same normalized input; hash mismatch emits `DETERMINISM_DRIFT_DETECTED` and fails strict. |

## Test Cases and Acceptance Scenarios
1. Base-ref resolution test verifies deterministic chain and exact code emission for each fallback branch.
2. Plan determinism test runs planner 100 times on identical input and asserts byte-identical `LensPlan[]`.
3. Queue determinism test asserts stable dispatch order across different machine core counts.
4. Conflict resolution test injects tied findings and verifies required deterministic ordering + evidence hash tie-break.
5. Strict-mode degradation test verifies required-lens provider outage yields `FAIL`.
6. Best-effort degradation test verifies non-required outage yields `PASS` only with `degraded=true` and codes.
7. Budget overflow test verifies deterministic stop/skip/escalate behavior by lens class and run mode.
8. Null metrics test verifies schema always includes token/cost fields with null + reason codes and deterministic aggregate rules.
9. No-silent-truncation test verifies omitted context is explicitly recorded and warnings are emitted.
10. Execution policy test verifies non-allowlisted command is deterministically rejected with `EXECUTION_POLICY_VIOLATION`.
11. Execution timeout test verifies deterministic `EXECUTION_TIMEOUT` mapping and strict/best-effort behavior.
12. Execution audit determinism test verifies identical commands produce stable audit ordering and stable output hashes.
13. Drift detection test replays same execution key and asserts hash equality or deterministic drift failure.

## Minimal v1 Implementation Sequence
1. Build orchestrator skeleton and normalized contracts (`SkillInput`, `LensPlan`, `LensResult`, `FinalVerdict`, `SkillResult`) plus schema validation.
2. Implement git base-ref resolution, diff classification, deterministic planner, and artifact writer.
3. Implement consistency lens with hybrid onboarding and versioned rubric freeze.
4. Implement two adapters (`openai-codex`, `anthropic-claude`) behind the normalized provider interface.
5. Implement permission profile evaluator and execution runner with sandboxed worktree support.
6. Implement deterministic verdict aggregation and conflict resolution logic.
7. Add drift-check command and deterministic replay/hash comparison.
8. Add conformance tests for determinism, PASS/FAIL semantics, budget/error behavior, and execution policy enforcement.

## Important Public API and Interface Additions
1. New CLI contract at `scripts/cli/run.ts` accepting normalized `SkillInput`.
2. New versioned JSON artifact contracts under `schemas/v1/`.
3. New lens plugin contract at `scripts/lenses/contracts.ts` for pluggable lens/sub-lens registration.
4. New provider adapter interface at `scripts/providers/types.ts` for Claude/Codex normalization.
5. New permission profile and execution-audit contracts for opt-in execution-enabled analyses.

## Assumptions and Defaults
1. Runtime is Bun-first; provider adapters use deterministic HTTP/API clients while remaining SDK-aligned.
2. Default run mode is `strict`.
3. Artifact root is `.qa-skill`.
4. Blocking policy is `rule_defined` in v1.
5. Consistency lens onboarding uses hybrid draft + human freeze.
6. API keys are supplied via environment variables and never written to artifacts.
7. Model IDs are required config values and must be pinned exactly per adapter version.
8. Non-read-only permission profiles are opt-in and disabled by default in initial rollout.

## References
1. [Agent Skills Open Specification](https://agentskills.io/specification)
2. [OpenAI Codex SDK](https://developers.openai.com/codex/sdk/)
3. [OpenAI Skills Guide](https://developers.openai.com/codex/skills/)
4. [Anthropic Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
