export type BaseRefWarningCode =
  | "BASE_REF_FALLBACK_ORIGIN_HEAD_UNAVAILABLE"
  | "BASE_REF_FALLBACK_ORIGIN_MAIN"
  | "BASE_REF_FALLBACK_ORIGIN_MASTER";

export type BaseRefErrorCode =
  | "BASE_REF_CONFIGURED_NOT_FOUND"
  | "BASE_REF_RESOLUTION_FAILED";

export type BaseRefCode = BaseRefWarningCode | BaseRefErrorCode;
