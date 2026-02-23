# Schema Validation Determinism

This project enforces deterministic schema validation and serialization for BEL-201 (`QAS-002`).

## Canonical Serialization Rules

1. JSON artifacts are serialized through `stableStringify` from `scripts/utils/canonical-json.ts`.
2. Object keys are always sorted lexicographically before serialization.
3. Array order is preserved exactly as provided.
4. `undefined` object keys are omitted; `undefined` array entries are normalized to `null`.
5. Artifact hashing uses canonical JSON (`hashCanonical`) to keep hash outputs stable across repeat runs.

## Deterministic Schema Error Ordering

Validation uses Ajv and then normalizes/Sorts errors by:

1. `instancePath`
2. `keyword`
3. `schemaPath`
4. canonicalized `params`
5. `message`

This normalization is implemented in `scripts/core/schema/validate.ts`.

## Boundary Validation Policy

Validation is enforced at all current artifact boundaries:

1. Config ingest: `scripts/core/config/loader.ts` validates against `qa-run-config.v1`.
2. Normalized input contract: `scripts/core/input/normalize.ts` validates against `skill-input.v1`.
3. Artifact write boundary: `scripts/core/artifacts/output.ts` validates `skill-input.v1` immediately before writing.

## Versioned Schema Set

Schemas live in `schemas/v1/`.

Included in BEL-201:

1. `qa-run-config.v1.json`
2. `skill-input.v1.json`
3. `lens-plan.v1.json`
4. `lens-result.v1.json`
5. `final-verdict.v1.json`
6. `skill-result.v1.json`
7. `execution-audit.v1.json`
8. `defs/common.v1.json`
