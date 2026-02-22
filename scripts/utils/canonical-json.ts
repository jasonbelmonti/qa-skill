export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function canonicalize(value: unknown): CanonicalJsonValue {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("Canonical JSON does not support non-finite numbers");
      }
      return value;
    case "object": {
      if (Array.isArray(value)) {
        return value.map((item) =>
          item === undefined ? null : canonicalize(item),
        );
      }

      if (!isPlainObject(value)) {
        throw new Error("Canonical JSON only supports plain objects and arrays");
      }

      const output: { [key: string]: CanonicalJsonValue } = {};
      const sortedKeys = Object.keys(value).sort();
      for (const key of sortedKeys) {
        const item = value[key];
        if (item !== undefined) {
          output[key] = canonicalize(item);
        }
      }
      return output;
    }
    default:
      throw new Error(`Canonical JSON does not support type: ${typeof value}`);
  }
}

export function stableStringify(
  value: unknown,
  options: { pretty?: boolean } = {},
): string {
  const canonical = canonicalize(value);
  return JSON.stringify(canonical, null, options.pretty ? 2 : 0);
}
