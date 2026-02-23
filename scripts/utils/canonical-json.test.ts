import { expect, test } from "bun:test";

import { canonicalize, stableStringify } from "./canonical-json";
import { hashCanonical } from "./hash";

test("stableStringify sorts object keys recursively", () => {
  const value = {
    z: 1,
    a: {
      d: 4,
      c: 3,
    },
    m: [{ y: 2, x: 1 }, 2],
  };

  expect(stableStringify(value)).toBe(
    '{"a":{"c":3,"d":4},"m":[{"x":1,"y":2},2],"z":1}',
  );
});

test("stableStringify preserves array order", () => {
  const value = { arr: [3, 1, 2] };
  expect(stableStringify(value)).toBe('{"arr":[3,1,2]}');
});

test("hashCanonical is deterministic across different key orders", () => {
  const a = { b: 2, a: 1, nested: { z: 9, y: 8 } };
  const b = { nested: { y: 8, z: 9 }, a: 1, b: 2 };

  expect(hashCanonical(a)).toBe(hashCanonical(b));
});

test("canonicalize omits undefined object keys and normalizes array undefined", () => {
  const value = {
    keep: 1,
    skip: undefined,
    arr: [1, undefined, 3],
  };

  expect(canonicalize(value)).toEqual({
    arr: [1, null, 3],
    keep: 1,
  });
});

test("stableStringify is deterministic for artifact-shaped payloads", () => {
  const a = {
    finalVerdict: {
      status: "PASS",
      degraded: false,
      schemaVersion: "final-verdict.v1",
      rationale: ["All required lenses completed"],
    },
    executionKey: "a".repeat(64),
    schemaVersion: "skill-result.v1",
  };

  const b = {
    schemaVersion: "skill-result.v1",
    executionKey: "a".repeat(64),
    finalVerdict: {
      rationale: ["All required lenses completed"],
      schemaVersion: "final-verdict.v1",
      degraded: false,
      status: "PASS",
    },
  };

  expect(stableStringify(a)).toBe(stableStringify(b));
});
