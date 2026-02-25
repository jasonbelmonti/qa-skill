# Diff Change Sensitivity Evaluation Design (v1)

## Summary
This design introduces deterministic, per-hunk change sensitivity evaluation for `qa-skill` so the orchestrator can distinguish high-risk implementation changes from low-risk informational edits.

The mechanism adds:
1. A deterministic sensitivity model at hunk, file, and run scope.
2. Explicit signal families for business logic, logical correctness, concurrency, deployment, runtime behavior, and low-impact changes (docs/comments/format-only).
3. Versioned contracts, artifacts, and policy configuration suitable for execution planning and JIRA decomposition.

## Problem Statement
Current change-surface classification (`scripts/core/git/change-surface-classifier.ts`) describes **what** changed (source/test/docs/config/infra) but does not quantify **how sensitive** each changed portion is. As a result:
1. High-risk hunks (for example, concurrency guards or deploy manifests) are not consistently prioritized.
2. Low-risk hunks (for example, documentation-only edits) can receive disproportionate analysis attention.
3. Lens selection and review depth cannot be tuned by risk profile in a deterministic way.
4. Execution planning lacks a stable risk substrate for backlog prioritization and rollout controls.

## Goals
1. Score every diff hunk on a deterministic `0..100` sensitivity scale.
2. Emit deterministic tiering and machine-readable reasons for each hunk.
3. Bias sensitivity toward production-impactful changes:
   - core business logic,
   - correctness-critical logic,
   - concurrency/state coordination,
   - deployment/infra/runtime behavior.
4. De-emphasize implementation-superfluous changes:
   - docs-only,
   - comments-only,
   - formatting-only.
5. Provide artifacts and contracts that directly feed:
   - lens planning/gating,
   - execution-plan generation,
   - JIRA work-item decomposition.

## Non-Goals (v1)
1. Predicting incident probability with ML.
2. Replacing human review decision making.
3. Introducing non-deterministic ranking heuristics.
4. Requiring language-complete semantic analysis for all file types.

## Requirement Index
- `CS-REQ-01`: Deterministic per-hunk sensitivity score and tier.
- `CS-REQ-02`: Deterministic reason tags and evidence for score explainability.
- `CS-REQ-03`: Explicit support for business logic/correctness/concurrency/deploy/runtime signals.
- `CS-REQ-04`: Explicit low-sensitivity treatment for docs/comments/format-only changes.
- `CS-REQ-05`: Repository-customizable policy for critical paths and overrides.
- `CS-REQ-06`: Stable, versioned artifact/schema for sensitivity outputs.
- `CS-REQ-07`: Deterministic file-level and run-level rollup.
- `CS-REQ-08`: Planner integration hooks for lens selection and enforcement policy.
- `CS-REQ-09`: Complexity and bounds suitable for large diffs.
- `CS-REQ-10`: Testable determinism and repeat-run reproducibility.

## Baseline and Gap
1. Existing input primitives:
   - `DiffCollectionResult` / `DiffHunk` from `scripts/core/git/diff-types.ts`.
   - `ChangeSurfaceResult` from `scripts/core/git/change-surface-types.ts`.
2. Existing strengths:
   - deterministic hunk ordering,
   - deterministic file classification,
   - deterministic symbol extraction from hunk headers.
3. Missing capability:
   - no risk/sensitivity scoring model,
   - no per-hunk production-impact evaluation,
   - no sensitivity artifact for planning.

## High-Level Architecture
### Flow placement
Insert sensitivity evaluation immediately after diff collection + change-surface classification and before lens planning:

1. Resolve base/head.
2. Collect diff hunks.
3. Classify change surface.
4. **Evaluate change sensitivity (new).**
5. Build lens plan using sensitivity-aware rules.
6. Execute lenses and aggregate verdict.

### New modules
1. `scripts/core/git/sensitivity-types.ts`
   - sensitivity enums/interfaces.
2. `scripts/core/git/sensitivity-policy.ts`
   - policy loading/validation/defaults.
3. `scripts/core/git/sensitivity-features.ts`
   - deterministic signal extraction.
4. `scripts/core/git/sensitivity-scorer.ts`
   - weighted score + tier + confidence.
5. `scripts/core/git/sensitivity-evaluator.ts`
   - orchestration and rollups.
6. `scripts/core/git/sensitivity-evaluator.test.ts`
   - deterministic fixture tests.

### Existing module updates
1. `scripts/core/git/diff-types.ts`
   - extend `DiffHunk` with bounded line-content evidence required for lexical sensitivity extraction.
2. `scripts/core/git/diff-collector.ts`
   - parse and persist bounded added/removed line excerpts per hunk.
3. `scripts/core/git/change-surface-types.ts`
   - optional reference fields linking to sensitivity summary (run/file-level).
4. Planner module (future implementation task)
   - consume sensitivity tiers for lens selection and enforcement.

## Sensitivity Model
### Units of evaluation
1. **Hunk sensitivity** is the primary unit and source of truth.
2. **File sensitivity** is a deterministic rollup of hunks in that file.
3. **Run sensitivity** is a deterministic rollup of all files/hunks in the change.

### Tier model
- `informational`: `0-14`
- `low`: `15-34`
- `moderate`: `35-59`
- `high`: `60-79`
- `critical`: `80-100`

### Reason tags
`SensitivityReason` (non-exhaustive v1):
1. `BUSINESS_LOGIC`
2. `CORRECTNESS_LOGIC`
3. `CONCURRENCY`
4. `DEPLOYMENT_SURFACE`
5. `RUNTIME_BEHAVIOR`
6. `DATA_SCHEMA_OR_MIGRATION`
7. `SECURITY_ACCESS_CONTROL`
8. `SHARED_CORE_BLAST_RADIUS`
9. `DOCS_ONLY`
10. `COMMENT_ONLY`
11. `FORMAT_ONLY`
12. `TEST_ONLY`
13. `NON_RUNTIME_ASSET`
14. `LOW_CONFIDENCE_FALLBACK`

## Signal Families and Mechanisms
Sensitivity is derived from deterministic evidence families. v1 uses rules/heuristics only.

### 1. Path and ownership signals
Inputs:
1. file path,
2. repository-defined glob rules,
3. known deploy/config directories.

Examples:
1. `src/domain/**`, `src/billing/**`, `src/auth/**` -> `BUSINESS_LOGIC`.
2. `infra/**`, `k8s/**`, `terraform/**`, `Dockerfile*`, `.github/workflows/**` -> `DEPLOYMENT_SURFACE`.
3. `migrations/**`, `schema/**`, `db/**` -> `DATA_SCHEMA_OR_MIGRATION`.

### 2. Hunk-header symbol signals
Inputs:
1. existing hunk header token extraction,
2. policy-provided symbol patterns.

Examples:
1. headers with `lock`, `mutex`, `semaphore`, `queue`, `retry`, `idempot` -> `CONCURRENCY`.
2. headers with `validate`, `invariant`, `assert`, `guard`, `authorize` -> `CORRECTNESS_LOGIC` or `SECURITY_ACCESS_CONTROL`.

### 3. Lexical diff-line signals (new)
Inputs:
1. bounded added/removed line excerpts,
2. deterministic keyword/regex tables by language class.

Examples:
1. Control-flow and correctness operators (`if`, comparisons, boundary checks, null handling) with altered logical operators -> `CORRECTNESS_LOGIC`.
2. Async/concurrency primitives (`await`, `Promise.all`, `lock`, `atomic`, `synchronized`) -> `CONCURRENCY`.
3. Runtime toggles (`FEATURE_`, env var reads, startup config branches) -> `RUNTIME_BEHAVIOR`.
4. Deploy knobs (`replicas`, resource limits, rollout strategy, image tags, CI deploy steps) -> `DEPLOYMENT_SURFACE`.

### 4. Structural change signals
Inputs:
1. changed line counts,
2. hunk count per file,
3. touched shared modules from policy.

Examples:
1. large edit in shared core module adds `SHARED_CORE_BLAST_RADIUS`.
2. migration + deploy in same change triggers interaction bonus.

### 5. Downgrade signals
Inputs:
1. bucket/language classification,
2. diff-line shape (comments-only/whitespace-only).

Examples:
1. markdown/docs path only with no runtime files -> `DOCS_ONLY`.
2. whitespace/comment-only hunk -> `COMMENT_ONLY` or `FORMAT_ONLY`.
3. tests-only change with no app/runtime surfaces -> `TEST_ONLY`.

## Deterministic Scoring Specification
### Base signal weights (v1 default)
Positive signals:
1. `BUSINESS_LOGIC`: `+28`
2. `CORRECTNESS_LOGIC`: `+22`
3. `CONCURRENCY`: `+26`
4. `DEPLOYMENT_SURFACE`: `+25`
5. `RUNTIME_BEHAVIOR`: `+18`
6. `DATA_SCHEMA_OR_MIGRATION`: `+24`
7. `SECURITY_ACCESS_CONTROL`: `+20`
8. `SHARED_CORE_BLAST_RADIUS`: `+12`

Negative/downgrade signals:
1. `DOCS_ONLY`: `-40` (score cap `<=10`)
2. `COMMENT_ONLY`: `-35` (score cap `<=8`)
3. `FORMAT_ONLY`: `-30` (score cap `<=8`)
4. `TEST_ONLY`: `-15` (score cap `<=25`)
5. `NON_RUNTIME_ASSET`: `-20` (score cap `<=15`)

### Interaction bonuses
1. `CONCURRENCY + DEPLOYMENT_SURFACE`: `+10`
2. `DATA_SCHEMA_OR_MIGRATION + DEPLOYMENT_SURFACE`: `+12`
3. `BUSINESS_LOGIC + CORRECTNESS_LOGIC`: `+8`
4. Three or more positive high-impact families in same hunk: `+15`

### Score function
1. `raw = sum(positiveWeights) + sum(negativeWeights) + interactionBonus + policyBoost`
2. Apply downgrade caps when downgrade reasons exist.
3. Clamp: `score = min(100, max(0, raw))`.
4. Map to tier by fixed ranges.

### Confidence function
`confidence` reflects evidence quality, not risk level.

1. Start at `0.35`.
2. Additions:
   - path/policy explicit match: `+0.20`
   - symbol/header evidence: `+0.10`
   - lexical line evidence: `+0.20`
   - multi-family corroboration: `+0.10`
   - explicit repository override rule: `+0.10`
3. Deductions:
   - parser/feature extraction degraded path: `-0.20`
   - evidence truncation due to hard bounds: `-0.10`
4. Clamp to `[0.10, 1.00]`.
5. If `confidence < 0.50`, append reason `LOW_CONFIDENCE_FALLBACK`.

## Rollup Rules (File and Run)
### File-level rollup
1. `fileScore = max(hunkScores for file)`.
2. `fileTier = tier(fileScore)`.
3. `fileReasons = deterministic union of reasons across hunks (sorted ASC)`.

### Run-level rollup
1. `runBase = max(fileScore)`.
2. `breadthBonus = min(10, highOrCriticalHunkCount + distinctPositiveReasonFamilyCount)`.
3. `runScore = clamp(0, 100, runBase + breadthBonus)`.
4. `runTier = tier(runScore)`.
5. `topSensitiveHunks` sorted by:
   - `score DESC`,
   - `confidence DESC`,
   - `filePath ASC`,
   - `hunkOrdinal ASC`.

## Determinism Guarantees
1. Rules and policy entries are normalized and sorted before evaluation.
2. Hunk iteration order is fixed: `filePath ASC`, `hunkOrdinal ASC`.
3. Reason sets are deduped and sorted lexicographically.
4. Tie-breakers are explicit for all ranked lists.
5. Regex tables are fixed and versioned with the schema version.
6. Any extraction failure produces deterministic warning codes and deterministic fallback behavior.

## Contracts and Schema Changes
### TypeScript contracts (new)
```ts
export type SensitivityTier =
  | "informational"
  | "low"
  | "moderate"
  | "high"
  | "critical";

export type SensitivityReason =
  | "BUSINESS_LOGIC"
  | "CORRECTNESS_LOGIC"
  | "CONCURRENCY"
  | "DEPLOYMENT_SURFACE"
  | "RUNTIME_BEHAVIOR"
  | "DATA_SCHEMA_OR_MIGRATION"
  | "SECURITY_ACCESS_CONTROL"
  | "SHARED_CORE_BLAST_RADIUS"
  | "DOCS_ONLY"
  | "COMMENT_ONLY"
  | "FORMAT_ONLY"
  | "TEST_ONLY"
  | "NON_RUNTIME_ASSET"
  | "LOW_CONFIDENCE_FALLBACK";

export interface SensitivitySignalEvidence {
  reason: SensitivityReason;
  weight: number;
  source: "path" | "header" | "lexical" | "structural" | "policy";
  evidence: string;
}

export interface HunkSensitivity {
  filePath: string;
  hunkOrdinal: number;
  score: number;
  tier: SensitivityTier;
  confidence: number;
  reasons: SensitivityReason[];
  evidence: SensitivitySignalEvidence[];
}

export interface FileSensitivity {
  filePath: string;
  score: number;
  tier: SensitivityTier;
  reasons: SensitivityReason[];
  hunkOrdinals: number[];
}

export interface ChangeSensitivityResult {
  schemaVersion: "change-sensitivity.v1";
  baseRef: string;
  headRef: string;
  runScore: number;
  runTier: SensitivityTier;
  runReasons: SensitivityReason[];
  hunkSensitivity: HunkSensitivity[];
  fileSensitivity: FileSensitivity[];
  topSensitiveHunks: Array<{ filePath: string; hunkOrdinal: number }>;
  warningCodes: string[];
}
```

### Diff contract extension (required)
`DiffHunk` additions for lexical evidence extraction:
```ts
export interface DiffHunk {
  filePath: string;
  hunkOrdinal: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  addedLineSamples: string[];
  removedLineSamples: string[];
}
```

Hard bounds:
1. max sampled lines per hunk: `80`.
2. max sampled chars per line: `240`.
3. truncation marker must be explicit and deterministic.

### Artifact addition
Per run, write:
1. `.qa-skill/runs/<executionKey>/change-sensitivity.json`

Potential follow-on (optional v1.1):
1. include sensitivity summary in `final-verdict.json`.

## Repository Policy Configuration
### New config file
`qa-sensitivity-policy.v1.json` (repo root).

### Policy schema (core fields)
1. `schemaVersion`
2. `criticalPathRules[]`
   - `glob`, `reasons[]`, `weightBoost`
3. `symbolRules[]`
   - `pattern`, `reasons[]`, `weight`
4. `lexicalRules[]`
   - `language`, `pattern`, `reasons[]`, `weight`
5. `downgradeRules[]`
   - `glob`, `reasons[]`, `cap`
6. `overrides[]`
   - deterministic include/exclude overrides for known false positives.

### Default behavior without policy
1. Use built-in defaults listed in this design.
2. Emit warning code `SENSITIVITY_POLICY_DEFAULTED`.

## Planner and Workflow Integration
### Lens planning inputs
Sensitivity output informs planner behavior:
1. `critical/high` hunks force broad lens coverage for touched areas.
2. `moderate` hunks follow normal targeted lens selection.
3. `informational/low` docs-only hunks allow narrow lens set and optional skip policies.

### Review and rollout policy suggestions
1. `critical`: require two reviewers, explicit rollout + rollback note, and execution evidence for relevant checks.
2. `high`: require senior reviewer and explicit test evidence.
3. `moderate`: normal review path.
4. `low/informational`: fast-path review where allowed.

## Error and Warning Codes (new)
1. `SENSITIVITY_POLICY_INVALID`
2. `SENSITIVITY_POLICY_DEFAULTED`
3. `SENSITIVITY_FEATURE_PARSE_DEGRADED`
4. `SENSITIVITY_EVIDENCE_TRUNCATED`
5. `SENSITIVITY_RESULT_SCHEMA_INVALID`

## Performance and Bounds
1. Target complexity: `O(hunks * activeRules)`.
2. Memory bound by capped lexical samples per hunk.
3. Deterministic short-circuit for docs-only/test-only files.
4. For very large diffs, sensitivity evaluation remains bounded and emits truncation/degraded warning codes as needed.

## Security and Privacy Considerations
1. No network access required.
2. No command execution required.
3. Lexical evidence stored in bounded excerpts; sensitive literal redaction MAY be added in v1.1.
4. Artifact paths and contracts follow existing versioning/determinism rules.

## Calibration and Governance
### Calibration loop
1. Track post-merge outcomes (defect escapes, rollback events, deploy incidents).
2. Compare outcomes against hunk/run tiers.
3. Tune weights/rules only through versioned policy updates.
4. Record calibration change log with before/after false-positive and false-negative samples.

### Versioning policy
1. Weight or reason semantics changes require policy version bump.
2. Contract shape changes require schema version bump.
3. Deterministic replay fixtures must be regenerated when version changes.

## Testing Strategy
1. Unit tests:
   - signal extraction per reason family,
   - score math and downgrade caps,
   - confidence clamping.
2. Determinism tests:
   - repeated-run byte-identical `change-sensitivity.json`.
3. Fixture tests:
   - business logic + correctness diff,
   - concurrency-only diff,
   - deployment + migration diff,
   - docs-only/comment-only/format-only diffs,
   - mixed diff with intentional tie-break cases.
4. Degraded tests:
   - policy missing/invalid,
   - evidence truncation,
   - parser fallback paths.

## Execution Planning Hooks (for JIRA Sync)
This design is intentionally decomposable into implementation epics and stories.

### Suggested epic structure
1. `CS-EPIC-1`: Contracts + schema + artifacts.
2. `CS-EPIC-2`: Feature extraction pipeline (path/header/lexical).
3. `CS-EPIC-3`: Scoring, confidence, tiering, rollups.
4. `CS-EPIC-4`: Policy loader/defaults/overrides.
5. `CS-EPIC-5`: Planner integration and workflow policy gates.
6. `CS-EPIC-6`: Determinism/performance test matrix and calibration tooling.

### Story template fields to include in JIRA
1. `Requirement IDs`: map to `CS-REQ-*`.
2. `Determinism acceptance`: explicit sorting/tie-break proof.
3. `Artifact/schema acceptance`: output path + schema validation.
4. `Bounds acceptance`: large-diff and truncation behavior.
5. `Fixture evidence`: named test fixture references.

## Migration and Rollout Strategy
1. Phase 1 (safe default): emit sensitivity artifacts only; no planner gating.
2. Phase 2: planner consumes sensitivity for lens breadth decisions.
3. Phase 3: enable policy-driven review/rollout guardrails by tier.
4. Phase 4: calibration pass and weight tuning from observed outcomes.

## Open Questions
1. Should v1 include AST-backed structural parsing for TypeScript, or remain lexical + header based to reduce initial complexity?
2. Should run-level score incorporate cross-file coupling via import graph in v1 or defer to v1.1?
3. Do we want tier-to-workflow policies encoded in orchestrator config, or managed externally by CI/JIRA automation first?

## Appendix A: Example Policy Snippet
```json
{
  "schemaVersion": "qa-sensitivity-policy.v1",
  "criticalPathRules": [
    {
      "glob": "src/domain/**",
      "reasons": ["BUSINESS_LOGIC"],
      "weightBoost": 8
    },
    {
      "glob": "src/concurrency/**",
      "reasons": ["CONCURRENCY"],
      "weightBoost": 10
    },
    {
      "glob": "infra/**",
      "reasons": ["DEPLOYMENT_SURFACE"],
      "weightBoost": 8
    }
  ],
  "downgradeRules": [
    {
      "glob": "docs/**",
      "reasons": ["DOCS_ONLY"],
      "cap": 10
    }
  ]
}
```

## Appendix B: Example Hunk Sensitivity Output
```json
{
  "filePath": "src/domain/orders/apply-discount.ts",
  "hunkOrdinal": 4,
  "score": 84,
  "tier": "critical",
  "confidence": 0.86,
  "reasons": [
    "BUSINESS_LOGIC",
    "CORRECTNESS_LOGIC",
    "RUNTIME_BEHAVIOR"
  ],
  "evidence": [
    {
      "reason": "BUSINESS_LOGIC",
      "weight": 28,
      "source": "path",
      "evidence": "matched criticalPathRules[src/domain/**]"
    },
    {
      "reason": "CORRECTNESS_LOGIC",
      "weight": 22,
      "source": "lexical",
      "evidence": "changed boundary check and inequality operator"
    }
  ]
}
```
