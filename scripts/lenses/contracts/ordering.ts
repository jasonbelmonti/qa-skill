import type { LensClass } from "../../contracts/common";
import type { LensDefinition, LensIdentity, LensSubLensDefinition } from "./types";
import { LENS_CLASS_PRIORITY } from "./types";
import { compareNullableText, compareText } from "./utils";

export function compareLensClass(left: LensClass, right: LensClass): number {
  return LENS_CLASS_PRIORITY[left] - LENS_CLASS_PRIORITY[right];
}

export function compareLensIdentity(left: LensIdentity, right: LensIdentity): number {
  return (
    compareLensClass(left.lensClass, right.lensClass) ||
    compareText(left.lensId, right.lensId) ||
    compareNullableText(left.subLensId, right.subLensId) ||
    compareText(left.lensVersion, right.lensVersion)
  );
}

export function compareSubLensDefinitions(
  left: LensSubLensDefinition,
  right: LensSubLensDefinition,
): number {
  return compareText(left.subLensId, right.subLensId);
}

export function compareLensDefinitions(
  left: LensDefinition,
  right: LensDefinition,
): number {
  return (
    compareLensClass(left.lensClass, right.lensClass) ||
    compareText(left.lensId, right.lensId) ||
    compareText(left.lensVersion, right.lensVersion)
  );
}

export function toLensIdentity(
  lensDefinition: Pick<LensDefinition, "lensId" | "lensVersion" | "lensClass">,
  subLens: Pick<LensSubLensDefinition, "subLensId"> | null = null,
): LensIdentity {
  return {
    lensId: lensDefinition.lensId,
    subLensId: subLens?.subLensId ?? null,
    lensVersion: lensDefinition.lensVersion,
    lensClass: lensDefinition.lensClass,
  };
}
