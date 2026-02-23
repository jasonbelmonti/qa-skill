import type { BaseRefErrorCode, BaseRefWarningCode } from "./error-codes";
import type { ContextBoundsResult } from "../core/context/types";
import type { ChangeSurfaceResult } from "../core/git/change-surface-types";
import type { DiffCollectionResult } from "../core/git/diff-types";

export interface BaseRefResolutionTrace {
  requestedBaseRef: string | null;
  resolvedBaseRef: string | null;
  warningCodes: BaseRefWarningCode[];
  errorCode: BaseRefErrorCode | null;
}

export interface DiffAnalysisTrace {
  diff: DiffCollectionResult;
  changeSurface: ChangeSurfaceResult;
  contextBounds: ContextBoundsResult;
}

export interface TraceArtifactV1 {
  schemaVersion: "trace.v1";
  baseRefResolution: BaseRefResolutionTrace;
  diffAnalysis?: DiffAnalysisTrace;
}
