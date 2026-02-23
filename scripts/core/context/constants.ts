import type { ContextBoundsLimits } from "./types";

export const DEFAULT_CONTEXT_BOUNDS_LIMITS: ContextBoundsLimits = {
  maxDiffFiles: 200,
  maxDiffHunks: 2000,
  maxContextFiles: 60,
  maxContextHunks: 600,
  maxContextChangedLines: 12000,
};
