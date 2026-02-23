export const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export const GIT_QUOTE_PATH_DISABLED_ARGS = ["-c", "core.quotepath=false"] as const;
