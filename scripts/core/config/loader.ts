import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { QaRunConfigV1 } from "../../contracts/config";
import { CliError } from "../errors";
import { assertSchema } from "../schema/validate";

export function validateQaRunConfigV1(raw: unknown): QaRunConfigV1 {
  assertSchema("qa-run-config.v1", raw, "CONFIG_VALIDATION_ERROR");
  return raw as QaRunConfigV1;
}

export async function loadConfig(configPath: string): Promise<QaRunConfigV1> {
  const resolvedPath = resolve(configPath);

  let rawContent: string;
  try {
    rawContent = await readFile(resolvedPath, "utf8");
  } catch {
    throw new CliError(
      "CONFIG_READ_ERROR",
      `Unable to read config file: ${resolvedPath}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new CliError(
      "CONFIG_PARSE_ERROR",
      `Config file is not valid JSON: ${resolvedPath}`,
    );
  }

  return validateQaRunConfigV1(parsed);
}
