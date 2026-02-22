You are a systems design agent for the qa-skill project.

Normative terms:

- The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are to be interpreted as described in RFC 2119 and RFC 8174 when shown in all caps.

Primary constraints:

1. The design `MUST` conform to the open spec at https://agentskills.io/specification.
2. The system `MUST` generate deterministic outputs and deterministic pass/fail results (stable ordering, bounded randomness, reproducible errors).
3. Interfaces `SHOULD` be simple and composable, and `SHOULD NOT` introduce framework-heavy complexity without clear necessity.
4. The system `MUST NOT` perform silent truncation, and `MUST NOT` send full diffs blindly.
5. The architecture `MUST` remain extensible for future analysis types (security, architecture, consistency, style, perf, etc.).
6. The solution `MUST` be compatible with both Claude and Codex.

- Claude Code Skill Documentation: https://code.claude.com/docs/en/skills
- Codex Skill Documentation: https://developers.openai.com/codex/skills/

7. Analysis execution `MUST` be optimized for efficiency.

- The system `MUST` include configurable concurrency.
- The system `MUST` dispatch analysis to sub-agents (read-only by default), and `MAY` allow execution-enabled sub-agents for explicitly permitted analysis types.
8. The design `MUST` define explicit `PASS|FAIL` semantics, including strict handling for degraded providers.
9. All schemas/artifacts `MUST` be versioned, and every ordered collection `MUST` define deterministic tie-break rules.
10. Provider/model invocation parameters `MUST` be pinned for reproducible runs.
11. The design `MUST` define measurable latency/cost/token budget targets and deterministic behavior when budgets are exceeded.

Required design outcome:

- The architecture `MUST` be **Skill-first**, with one orchestration layer and provider-specific adapters behind a stable interface.
- The design `MUST` include a **pluggable lens/sub-lens registration and onboarding model** (comparable to LensSpec, aligned with Skill abstractions).
- The implementation `MUST` build a TypeScript orchestrator in `/scripts` that:
  a) `MUST` normalize/expose a stable interface across Claude/Codex/provider SDKs,
  b) `MUST` run subagents concurrently within configured bounds,
  c) `MUST` handle queueing/retries/timeouts and result aggregation,
  d) `MUST` emit deterministic trace/artifact metadata,
  e) `SHOULD` be grounded in https://developers.openai.com/codex/sdk/ and https://platform.claude.com/docs/en/agent-sdk/overview.
- The architecture `MUST` replace large-payload assumptions with a **diff-driven, staged analysis flow**:
  - It `MUST` determine changed files against a configured base ref.
  - Base ref resolution `MUST` be deterministic:
    - use configured `baseRef` when provided,
    - else resolve repo default branch from `origin/HEAD`,
    - else fallback to `origin/main`,
    - else fallback to `origin/master`,
    - and `MUST` emit a deterministic warning/error code when falling back.
  - It `SHOULD` classify change type/surface quickly.
  - It `MUST` select minimal relevant lenses and scoped file sets.
  - It `MUST` load full file context only when needed and `MUST` enforce hard bounds.
- The design `MUST` add an onboarding flow for a repo-level “**consistency lens**” that:
  - `MUST` capture architecture/style/decision patterns not covered by static checkers,
  - `MUST` yield a deterministic rubric/tuning baseline,
  - `MUST` be versioned and re-runnable.
- The planner `MUST` implement deterministic run-plan generation:
  - It `MUST` select lens sets by touched file types/symbols/rules.
  - It `MAY` fallback to a broader scan when confidence is low.
- Final output `MUST` include:
  - `PASS|FAIL`,
  - deterministic rationale,
  - per-lens evidence summary,
  - conflict-free ordering and a stable JSON schema,
  - deterministic error codes for missing artifacts/degraded providers,
  - token counts,
  - cost information when available.

Verdict semantics (required):

- `PASS` `MUST` be returned only when all required lenses complete successfully and no blocking findings exist.
- `FAIL` `MUST` be returned when any blocking finding exists, any required lens is missing, or execution cannot satisfy strict-mode completeness.
- The run mode `MUST` be explicit:
  - `strict`: any provider/lens degradation that affects required scope `MUST` yield `FAIL`.
  - `best_effort`: non-required lens/provider failures `MAY` still produce `PASS`, but `degraded=true` and deterministic degradation codes are `MUST` requirements.
- Conflict resolution `MUST` be deterministic:
  - sort findings by `severity DESC`, then `lensId ASC`, `file ASC`, `startLine ASC`, `ruleId ASC`,
  - ties on identical findings `MUST` resolve by stable hash of normalized evidence payload.

Determinism controls (required):

- All arrays/maps in artifacts (lenses, files, findings, errors, metrics, traces) `MUST` have deterministic ordering.
- The system `MUST` derive a stable idempotent execution key from normalized inputs:
  - repo identifier,
  - base/head commit SHAs,
  - selected lens versions,
  - provider adapter versions,
  - run mode and config hash.
- Bounded concurrency `MUST` be explicit and deterministic:
  - fixed worker count from config,
  - deterministic queue order,
  - no unbounded fan-out.
- LLM/provider invocation controls:
  - exact model IDs per adapter version `MUST` be pinned,
  - `temperature`, `top_p`, `max_tokens`, and related sampling parameters `MUST` be fixed,
  - deterministic seed `SHOULD` be used when the provider supports it,
  - retry count and backoff schedule `MUST` be fixed,
  - terminal error code after retry exhaustion `MUST` be deterministic.

Efficiency targets (required):

- The design doc `MUST` include concrete SLOs:
  - target p50/p95 runtime by diff size bucket (small/medium/large),
  - max token budget per lens and per run,
  - optional max cost budget per run.
- Budget overflow behavior `MUST` be deterministic:
  - stop/skip/escalate policy `MUST` be defined per lens class,
  - stable error/warning codes `MUST` be emitted for budget-triggered degradation.

Metrics nullability semantics (required):

- Token/cost fields `MUST` be present in schema even when unavailable.
- Explicit nullable fields and reason codes `MUST` be used:
  - `inputTokens`, `outputTokens`, `totalTokens`: `number | null`
  - `costUsd`: `number | null`
  - `unavailableReason`: enum (for example `PROVIDER_NOT_SUPPORTED`, `MISSING_USAGE_DATA`, `ADAPTER_ERROR`)
- Aggregate totals `MUST` be deterministic and `MUST` exclude `null` values using documented rules.
- Every emitted artifact `MUST` include `schemaVersion`, and parsing rules `SHOULD` remain backward compatible.

Please provide:

1. A proposed module layout that `MUST` cover:
   - skill metadata + manifest/registration
   - orchestrator CLI (`/scripts`)
   - provider normalization layer
   - lens plugin contracts
2. A reference TypeScript API/contract (`SkillInput`, `SkillResult`, `LensPlan`, `LensResult`, `FinalVerdict`) with strict field types.
3. A determinism plan that `MUST` define:
   - deterministic sorting,
   - bounded concurrency,
   - stable idempotent execution keys,
   - deterministic conflict resolution.
4. Risk/edge-case treatment that `MUST` address:
   - huge diffs,
   - provider failures,
   - mixed-success partial runs,
   - base-ref discovery/fallback failures,
   - budget exhaustion behavior,
   - determinism drift detection across repeated runs.

Deliverables:

- A design doc `MUST` be suitable for Linear implementation handoff.
- The minimal v1 implementation sequence `SHOULD` follow this no-friction path:
  1. orchestrator + contract normalization,
  2. one “consistency lens” baseline,
  3. 1–2 provider adapters,
  4. deterministic verdict endpoint artifact.

Resources:
