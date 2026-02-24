import type { ErrorCode } from "../../contracts/common";
import type { LensPlan } from "../../contracts/artifacts";
import type { SkillInput } from "../../contracts/skill-input";
import type { ContextBoundsResult } from "../context/types";
import type { ChangeSurfaceResult } from "../git/change-surface-types";
import type { LoadedLensRegistry } from "../../lenses/loader";

export type PlannerWarningCode = Extract<
  ErrorCode,
  "PLAN_CONFIDENCE_LOW_BROAD_SCAN"
>;

export interface BuildLensPlansInput {
  skillInput: SkillInput;
  registry: LoadedLensRegistry;
  selectedLensIds: readonly string[];
  changeSurface: ChangeSurfaceResult;
  contextBounds: ContextBoundsResult;
}

export interface PlannerDiagnostic {
  lensId: string;
  subLensId: string;
  score: number;
  minConfidence: number;
  fileMatchSignal: 0 | 0.6;
  prefixSignal: 0 | 0.2;
  symbolSignal: 0 | 0.2;
  matchedFileCount: number;
  matchedFiles: string[];
  selected: boolean;
  broadFallback: boolean;
}

export interface BuildLensPlansResult {
  lensPlans: LensPlan[];
  warningCodes: PlannerWarningCode[];
  diagnostics: PlannerDiagnostic[];
}
