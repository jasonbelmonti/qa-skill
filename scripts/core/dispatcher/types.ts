import type { LensPlan, LensResult } from "../../contracts/artifacts";
import type { ProviderBinding, SkillInput } from "../../contracts/skill-input";

export interface DispatchTask {
  queueOrdinal: number;
  plan: LensPlan;
}

export interface BuildDispatcherPreflightInput {
  skillInput: SkillInput;
  lensPlans: readonly LensPlan[];
}

export interface BuildDispatcherPreflightResult {
  primaryProviderBinding: ProviderBinding;
  tasks: DispatchTask[];
}

export interface DispatchAttemptInput {
  skillInput: SkillInput;
  primaryProviderBinding: ProviderBinding;
  task: DispatchTask;
  attemptOrdinal: number;
}

export type DispatchLensPlanExecutor = (
  input: DispatchAttemptInput,
) => Promise<LensResult>;
