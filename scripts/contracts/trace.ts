import type { BaseRefErrorCode, BaseRefWarningCode } from "./error-codes";

export interface BaseRefResolutionTrace {
  requestedBaseRef: string | null;
  resolvedBaseRef: string | null;
  warningCodes: BaseRefWarningCode[];
  errorCode: BaseRefErrorCode | null;
}

export interface TraceArtifactV1 {
  schemaVersion: "trace.v1";
  baseRefResolution: BaseRefResolutionTrace;
}
