import type {
  LensDefinition,
  LensSubLensDefinition,
  LensTriggerMetadata,
} from "./types";
import {
  compareLensDefinitions,
  compareSubLensDefinitions,
} from "./ordering";
import { sortedStrings } from "./utils";

export function normalizeLensTriggerMetadata(
  trigger: LensTriggerMetadata,
): LensTriggerMetadata {
  return {
    includeGlobs: sortedStrings(trigger.includeGlobs),
    excludeGlobs: sortedStrings(trigger.excludeGlobs),
    pathPrefixes: sortedStrings(trigger.pathPrefixes),
    symbolHints: sortedStrings(trigger.symbolHints),
    minConfidence: trigger.minConfidence,
  };
}

export function normalizeSubLensDefinition(
  subLens: LensSubLensDefinition,
): LensSubLensDefinition {
  return {
    ...subLens,
    trigger: normalizeLensTriggerMetadata(subLens.trigger),
  };
}

export function normalizeLensDefinition(lens: LensDefinition): LensDefinition {
  return {
    ...lens,
    trigger: normalizeLensTriggerMetadata(lens.trigger),
    subLenses: lens.subLenses
      .map(normalizeSubLensDefinition)
      .sort(compareSubLensDefinitions),
  };
}

export function normalizeLensDefinitions(
  lenses: readonly LensDefinition[],
): LensDefinition[] {
  return lenses.map(normalizeLensDefinition).sort(compareLensDefinitions);
}
