import type { QaRunConfigV1 } from "../../contracts/config";
import type { SkillInput } from "../../contracts/skill-input";
import type { TraceArtifactV1 } from "../../contracts/trace";
import type { BaseRefResolutionResult } from "../git/types";

export interface NormalizeOptions {
  cwd?: string;
  resolveRealpath?: (path: string) => Promise<string>;
  getOriginRemoteUrl?: (repoRoot: string) => Promise<string | null>;
  resolveBaseRef?: (
    repoRoot: string,
    configuredBaseRef: QaRunConfigV1["baseRef"] | null,
  ) => Promise<BaseRefResolutionResult>;
}

export interface NormalizeConfigForRunResult {
  input: SkillInput;
  trace: TraceArtifactV1;
}
