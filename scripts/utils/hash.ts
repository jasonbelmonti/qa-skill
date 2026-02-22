import { createHash } from "node:crypto";

import { stableStringify } from "./canonical-json";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(stableStringify(value));
}
