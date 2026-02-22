import type { CliErrorCode } from "./types";

export const EXIT_CODE_BY_ERROR: Record<CliErrorCode, number> = {
  USAGE_ERROR: 2,
  CONFIG_READ_ERROR: 3,
  CONFIG_PARSE_ERROR: 3,
  CONFIG_VALIDATION_ERROR: 3,
  OUT_DIR_NON_EMPTY: 4,
  ARTIFACT_WRITE_ERROR: 5,
};
