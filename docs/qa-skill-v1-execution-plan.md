# Linear Execution Plan: QA Skill v1 (Deterministic Orchestrator)

## Summary
This plan converts the approved design into a 6-week, 3-sprint execution backlog with:
1. Granular Linear-ready tasks (2-level hierarchy: milestone epics + child tasks).
2. Explicit dependencies and point estimates.
3. Requirement-mapped acceptance criteria.
4. Three hard-gated live demo milestones with manual verification instructions.

Planning defaults locked from prior decisions:
1. Linear target: new project.
2. Timeline: 3 sprints (6 weeks), hard gate between milestones.
3. Estimates: story points (1-8).
4. Adapter rollout: Codex first, Claude second.
5. Execution mode: read-only default, opt-in permission profiles.

## Requirement Index (for acceptance mapping)
- `REQ-01`: Skill-first architecture with stable orchestrator + adapter interface.
- `REQ-02`: Diff-driven staged flow + deterministic base-ref fallback chain.
- `REQ-03`: Determinism controls (ordering, idempotent execution key, bounded concurrency, fixed retries).
- `REQ-04`: Explicit `PASS|FAIL` semantics (`strict` and `best_effort`) with deterministic degraded handling.
- `REQ-05`: Versioned schemas/artifacts and backward-compatible parsing.
- `REQ-06`: Final output schema includes rationale, evidence summaries, deterministic codes, tokens, cost when available.
- `REQ-07`: Metrics nullability semantics and deterministic aggregate rules.
- `REQ-08`: Concrete SLO/budget targets and deterministic overflow behavior.
- `REQ-09`: Consistency lens onboarding is deterministic, versioned, and rerunnable.
- `REQ-10`: Sub-agent model is read-only by default with explicit execution permission profiles and audit trail.
- `REQ-11`: Claude and Codex compatibility with pinned invocation parameters.
- `REQ-12`: Edge-case coverage (huge diff, provider failures, mixed-success runs, base-ref failures, drift detection).

## Linear Project Setup
1. Team: `Belmocorp`.
2. Create project: `QA Skill v1 - Deterministic Orchestrator`.
3. Dates: start `2026-02-23`, target `2026-04-05`.
4. Priority: High.
5. Workflow states: `Backlog -> Todo -> In Progress -> In Review -> Done`.
6. Labels: `qa-skill-v1`, `determinism`, `lens`, `adapter`, `execution`, `demo-gate`, `schema`.
7. Parent issues (epics): `MS1`, `MS2`, `MS3` as milestone gates.
8. Dependency rule: `MS2` blocked by `MS1`; `MS3` blocked by `MS2`.
9. Child issue rule: no child of next milestone may move to `In Progress` until prior milestone gate issue is `Done`.

## Milestone Schedule
1. Sprint 1 (`2026-02-23` to `2026-03-08`): `MS1 Deterministic Planning Kernel`.
2. Sprint 2 (`2026-03-09` to `2026-03-22`): `MS2 Read-Only End-to-End Verdict`.
3. Sprint 3 (`2026-03-23` to `2026-04-05`): `MS3 Permissioned Execution + Multi-Provider Parity`.

## Important Public API / Interface Commitments
1. CLI commands to implement:
   - `bun run qa:run -- --config <path> --out <runDir>`
   - `bun run qa:consistency:init -- --mode draft|freeze ...`
   - `bun run qa:drift:check -- --run-a <dir> --run-b <dir>`
2. Versioned schemas:
   - `skill-input.v1`, `lens-plan.v1`, `lens-result.v1`, `final-verdict.v1`, `skill-result.v1`, `execution-audit.v1`.
3. Required artifact files per run directory:
   - `input.normalized.json`
   - `lens-plan.json`
   - `lens-results.json`
   - `final-verdict.json`
   - `metrics.json`
   - `trace.json`
   - `execution-audit.json` (only when execution occurs)
   - `hashes.json`
4. Permission model contracts:
   - `PermissionProfile`, `ExecutionCommandSpec`, `ExecutionAudit` as first-class API objects.

## Backlog (Linear-Ready Tasks)

| ID | Parent | Title | Pts | Depends On | Acceptance Criteria | Req |
|---|---|---|---:|---|---|---|
| QAS-001 | MS1 | CLI/config bootstrap and normalized input loader | 3 | - | `qa:run` reads config, normalizes defaults, writes `input.normalized.json`; deterministic config hash emitted | REQ-01, REQ-03, REQ-05 |
| QAS-002 | MS1 | Implement v1 schema set + validation layer | 3 | QAS-001 | All v1 schemas validate/serialize deterministically; invalid payloads return deterministic schema code | REQ-05, REQ-06, REQ-07 |
| QAS-003 | MS1 | Deterministic base-ref resolver with fallback codes | 3 | QAS-001 | Resolution order exactly matches design; each fallback emits deterministic code; failure code on exhaustion | REQ-02, REQ-12 |
| QAS-004 | MS1 | Diff collector + change-surface classifier + context bounds | 5 | QAS-003 | Changed files/hunks computed; bounded loading enforced; omitted files explicitly listed with warning code | REQ-02, REQ-03 |
| QAS-005 | MS1 | Deterministic planner and queue ordering engine | 5 | QAS-002, QAS-004 | `LensPlan[]` byte-identical across repeat runs; queue ordering follows fixed sort rule | REQ-03, REQ-01 |
| QAS-006 | MS1 | Dispatcher with fixed concurrency/retry/timeout | 5 | QAS-005 | Worker count fixed by config; retry/backoff deterministic; no unbounded fan-out | REQ-03, REQ-08 |
| QAS-007 | MS1 | Artifact writer + execution key + hash manifest | 5 | QAS-002, QAS-005, QAS-006 | Stable execution key generated; artifacts sorted; `hashes.json` reproducible | REQ-03, REQ-05, REQ-06 |
| QAS-008 | MS1 | Determinism test suite + MS1 demo script bundle | 3 | QAS-003, QAS-005, QAS-007 | Repeated-run determinism tests pass; manual demo script produces expected artifacts | REQ-03, REQ-12 |

| QAS-009 | MS2 | Consistency rubric onboarding (draft + freeze) | 3 | QAS-002, QAS-005 | Draft rubric generated deterministically; freeze locks rubric version/hash; rerun creates new immutable draft | REQ-09, REQ-05 |
| QAS-010 | MS2 | Consistency lens runtime + rule-defined blocking | 5 | QAS-009, QAS-005 | Lens emits findings with explicit `blocking`; blocking behavior follows rule metadata | REQ-09, REQ-04 |
| QAS-011 | MS2 | Codex adapter normalization (pinned params) | 5 | QAS-001, QAS-002 | Adapter pins model + sampling + timeout + retries; usage mapped to nullable metrics contract | REQ-11, REQ-07 |
| QAS-012 | MS2 | Verdict aggregation + deterministic conflict resolution | 5 | QAS-010, QAS-011, QAS-007 | `PASS|FAIL` semantics implemented; conflict sort tie-break by evidence hash verified | REQ-04, REQ-06 |
| QAS-013 | MS2 | Budget/SLO engine + overflow behavior | 5 | QAS-012 | Per-lens/run budget enforcement implemented; deterministic stop/skip/escalate codes emitted | REQ-08, REQ-12 |
| QAS-014 | MS2 | Metrics nullability and deterministic aggregate totals | 3 | QAS-011, QAS-012 | Token/cost fields always present; null reasons required; totals exclude null deterministically | REQ-07, REQ-06 |
| QAS-015 | MS2 | End-to-end read-only fixture suite + MS2 demo script | 3 | QAS-012, QAS-013, QAS-014 | Read-only run yields deterministic verdict artifacts across reruns; failure fixture yields stable FAIL | REQ-04, REQ-06, REQ-12 |

| QAS-016 | MS3 | Claude adapter parity with Codex normalization contract | 5 | QAS-011 | Claude adapter reaches same normalized `LensResult` surface; pinned params and error mapping verified | REQ-11, REQ-06 |
| QAS-017 | MS3 | Permission profile policy engine + allowlist validator | 5 | QAS-001 | `read_only` default enforced; command allowlist and profile checks return deterministic deny/violation codes | REQ-10, REQ-03 |
| QAS-018 | MS3 | Execution runner with deterministic ephemeral worktree policy | 5 | QAS-017, QAS-006 | Execution runs only in `.worktrees/qa-skill/<executionKey>/<planOrdinal>/`; primary checkout never mutated | REQ-10, REQ-03 |
| QAS-019 | MS3 | Execution audit artifact + execution error code mapping | 3 | QAS-018, QAS-007 | `execution-audit.json` emitted with command ordinals + output hashes + exit/timeout state | REQ-10, REQ-06 |
| QAS-020 | MS3 | Drift-check CLI and replay comparison | 3 | QAS-007, QAS-012 | Replayed identical runs compare hash-equivalent; mismatch returns deterministic drift code | REQ-03, REQ-12 |
| QAS-021 | MS3 | Edge-case matrix tests + MS3 demo script | 5 | QAS-013, QAS-016, QAS-019, QAS-020 | Huge diff/provider degradation/execution denial/timeouts all mapped to deterministic outcomes | REQ-12, REQ-04, REQ-10 |
| QAS-022 | MS3 | Release handoff docs + Linear go-live checklist | 2 | QAS-015, QAS-021 | Operator docs, runbook, and acceptance evidence linked in Linear; milestone sign-off checklist complete | REQ-01 through REQ-12 |

## Dependency and Critical Path
1. Critical path:
   - `QAS-001 -> QAS-003 -> QAS-004 -> QAS-005 -> QAS-006 -> QAS-007 -> QAS-012 -> QAS-013 -> QAS-021 -> QAS-022`.
2. Adapter path:
   - `QAS-011 -> QAS-016`.
3. Execution path:
   - `QAS-017 -> QAS-018 -> QAS-019 -> QAS-021`.
4. Onboarding path:
   - `QAS-009 -> QAS-010 -> QAS-012`.

## Live Demo Milestones (Hard Gates)

### MS1 Demo Gate: Deterministic Planning Kernel (`2026-03-08`)
Manual verification steps:
1. Run twice with identical config:
   - `bun run qa:run -- --config examples/config/ms1.strict.readonly.json --out .qa-skill/runs/ms1-a`
   - `bun run qa:run -- --config examples/config/ms1.strict.readonly.json --out .qa-skill/runs/ms1-b`
2. Compare deterministic artifacts:
   - `diff .qa-skill/runs/ms1-a/lens-plan.json .qa-skill/runs/ms1-b/lens-plan.json`
   - `diff .qa-skill/runs/ms1-a/hashes.json .qa-skill/runs/ms1-b/hashes.json`
3. Force base-ref failure path:
   - `bun run qa:run -- --config examples/config/ms1.bad-baseref.json --out .qa-skill/runs/ms1-c`
4. Verify deterministic error code in `.qa-skill/runs/ms1-c/trace.json`.

Pass criteria:
1. No diff for repeated-run artifacts.
2. Base-ref failure code matches contract exactly.
3. All MS1 child tasks `Done` and linked test evidence present.

### MS2 Demo Gate: Read-Only End-to-End Verdict (`2026-03-22`)
Manual verification steps:
1. Generate/freeze consistency rubric:
   - `bun run qa:consistency:init -- --mode draft --repo . --out .qa-skill/consistency/drafts`
   - `bun run qa:consistency:init -- --mode freeze --draft <draftPath> --rubric-version v1`
2. Run strict read-only analysis on fixture diff:
   - `bun run qa:run -- --config examples/config/ms2.strict.codex.json --out .qa-skill/runs/ms2-a`
3. Run same input again:
   - `bun run qa:run -- --config examples/config/ms2.strict.codex.json --out .qa-skill/runs/ms2-b`
4. Validate outputs:
   - `final-verdict.json` includes `status`, `degraded`, deterministic rationale ordering, required lens outcomes.
   - `lens-results.json` finding order follows deterministic conflict sort.
5. Budget overflow check:
   - Run with `examples/config/ms2.low-budget.json`; verify deterministic budget code and policy behavior.

Pass criteria:
1. Strict mode behavior matches required completeness semantics.
2. Token/cost nullability fields always present and valid.
3. Repeated runs are hash-identical for same input.
4. All MS2 child tasks `Done` and linked evidence present.

### MS3 Demo Gate: Permissioned Execution + Multi-Provider Parity (`2026-04-05`)
Manual verification steps:
1. Verify read-only default denies execution:
   - `bun run qa:run -- --config examples/config/ms3.readonly-deny.json --out .qa-skill/runs/ms3-a`
   - Confirm `EXECUTION_DENIED` in result codes.
2. Verify allowed execution profile:
   - `bun run qa:run -- --config examples/config/ms3.exec-sandboxed.json --out .qa-skill/runs/ms3-b`
   - Confirm worktree path under `.worktrees/qa-skill/<executionKey>/<planOrdinal>/`.
3. Verify policy violation handling:
   - `bun run qa:run -- --config examples/config/ms3.policy-violation.json --out .qa-skill/runs/ms3-c`
   - Confirm `EXECUTION_POLICY_VIOLATION`.
4. Verify Claude parity:
   - Run same fixture with Codex and Claude configs; compare normalized `LensResult` shape and deterministic ordering guarantees.
5. Drift check:
   - `bun run qa:drift:check -- --run-a .qa-skill/runs/ms3-b --run-b .qa-skill/runs/ms3-b-replay`

Pass criteria:
1. Execution only occurs when both class allowlist and non-read-only profile permit it.
2. `execution-audit.json` exists with deterministic command order and output hashes.
3. Drift check passes for equivalent runs.
4. All MS3 child tasks `Done` and linked evidence present.

## Global Test Scenarios (must exist by end of MS3)
1. Deterministic planner reproducibility test (100 identical runs).
2. Deterministic queue ordering under varying machine core counts.
3. Base-ref fallback chain and deterministic code coverage.
4. Conflict resolution tie-break correctness test.
5. Strict vs best_effort verdict behavior tests for degraded providers/lenses.
6. Budget overflow behavior tests by lens class and run mode.
7. Metrics nullability/aggregation correctness tests.
8. Execution permission denial/violation/timeout tests.
9. Large-diff hard-bound behavior and explicit omission signaling tests.
10. Drift detection positive and negative tests.

## Linear Entry Procedure
1. Create project and three milestone parent issues (`MS1`, `MS2`, `MS3`) in `Backlog`.
2. Create child issues `QAS-001` through `QAS-022` with points/dependencies from this plan.
3. Link each child issue to its requirement IDs in description.
4. Add demo-gate checklist to each milestone parent; do not mark parent `Done` until checklist passes.
5. During execution, require each issue to attach:
   - test output reference,
   - artifact path reference,
   - short acceptance evidence note.

## Assumptions and Defaults
1. One primary engineering owner with optional reviewer support.
2. No scope expansion beyond v1 requirements listed in `VISION.md`.
3. CLI names and artifact file names listed above are accepted as contractual for implementation.
4. Provider credentials are environment-injected and excluded from artifacts.
5. Any new requirement discovered mid-sprint is logged as separate backlog issue, not merged into active milestone gate.
