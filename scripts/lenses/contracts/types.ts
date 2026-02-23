import type {
  BlockingPolicy,
  LensClass,
  PermissionProfileId,
} from "../../contracts/common";

export const LENS_CLASSES: readonly LensClass[] = [
  "consistency",
  "security",
  "architecture",
  "style",
  "performance",
];

export const PERMISSION_PROFILE_IDS: readonly PermissionProfileId[] = [
  "read_only",
  "exec_sandboxed",
  "exec_sandboxed_network_off",
];

export const BLOCKING_POLICIES: readonly BlockingPolicy[] = [
  "rule_defined",
  "severity_threshold",
  "mixed",
];

export const LENS_CLASS_PRIORITY: Readonly<Record<LensClass, number>> = {
  consistency: 0,
  security: 1,
  architecture: 2,
  style: 3,
  performance: 4,
};

export interface LensTriggerMetadata {
  includeGlobs: string[];
  excludeGlobs: string[];
  pathPrefixes: string[];
  symbolHints: string[];
  minConfidence: number;
}

export interface LensSubLensDefinition {
  subLensId: string;
  title: string;
  description: string;
  required: boolean;
  blockingPolicy: BlockingPolicy;
  trigger: LensTriggerMetadata;
}

export interface LensDefinition {
  lensId: string;
  lensVersion: string;
  lensClass: LensClass;
  title: string;
  description: string;
  requiredByDefault: boolean;
  defaultPermissionProfileId: PermissionProfileId;
  trigger: LensTriggerMetadata;
  subLenses: LensSubLensDefinition[];
}

export interface LensIdentity {
  lensId: string;
  subLensId: string | null;
  lensVersion: string;
  lensClass: LensClass;
}

export interface LensContractIssue {
  path: string;
  message: string;
}
