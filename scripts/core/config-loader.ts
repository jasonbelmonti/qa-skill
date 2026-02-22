import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { QaRunConfigV1 } from "../contracts/config";
import type {
  LensClass,
  PermissionProfile,
  PermissionProfileId,
  ProviderBinding,
  RunMode,
} from "../contracts/skill-input";
import { CliError } from "./errors";

const LENS_CLASSES: readonly LensClass[] = [
  "consistency",
  "security",
  "architecture",
  "style",
  "performance",
];

const PERMISSION_PROFILE_IDS: readonly PermissionProfileId[] = [
  "read_only",
  "exec_sandboxed",
  "exec_sandboxed_network_off",
];

const RUN_MODES: readonly RunMode[] = ["strict", "best_effort"];

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "repoId",
  "repoRoot",
  "baseRef",
  "headRef",
  "runMode",
  "requestedLensIds",
  "maxConcurrency",
  "allowExecutionLensClasses",
  "permissionProfiles",
  "defaultPermissionProfileId",
  "artifactRoot",
  "runBudgetMaxTokens",
  "runBudgetMaxCostUsd",
  "providerBindings",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function failValidation(message: string): never {
  throw new CliError("CONFIG_VALIDATION_ERROR", message);
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    failValidation(`${field} must be a non-empty string`);
  }
  return value;
}

function expectOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return expectString(value, field);
}

function expectOptionalNullableString(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  return expectString(value, field);
}

function expectPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    failValidation(`${field} must be a positive integer`);
  }
  return value;
}

function expectNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    failValidation(`${field} must be a non-negative integer`);
  }
  return value;
}

function expectOptionalNullableNumber(
  value: unknown,
  field: string,
): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    failValidation(`${field} must be a non-negative finite number or null`);
  }
  return value;
}

function expectArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    failValidation(`${field} must be an array`);
  }
  return value;
}

function validateRequestedLensIds(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  const entries = expectArray(value, "requestedLensIds");
  return entries.map((item, index) =>
    expectString(item, `requestedLensIds[${index}]`),
  );
}

function validateLensClasses(value: unknown): LensClass[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const entries = expectArray(value, "allowExecutionLensClasses");
  return entries.map((item, index) => {
    const lensClass = expectString(item, `allowExecutionLensClasses[${index}]`);
    if (!LENS_CLASSES.includes(lensClass as LensClass)) {
      failValidation(`allowExecutionLensClasses[${index}] is invalid`);
    }
    return lensClass as LensClass;
  });
}

function validateAllowedCommandPrefixes(
  value: unknown,
): PermissionProfile["allowedCommandPrefixes"] {
  const prefixes = expectArray(value, "allowedCommandPrefixes");
  return prefixes.map((prefix, prefixIndex) => {
    const tokens = expectArray(prefix, `allowedCommandPrefixes[${prefixIndex}]`);
    return tokens.map((token, tokenIndex) =>
      expectString(token, `allowedCommandPrefixes[${prefixIndex}][${tokenIndex}]`),
    );
  });
}

function validatePermissionProfiles(
  value: unknown,
): PermissionProfile[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const profiles = expectArray(value, "permissionProfiles");

  return profiles.map((profileRaw, index) => {
    if (!isPlainObject(profileRaw)) {
      failValidation(`permissionProfiles[${index}] must be an object`);
    }
    const profile = profileRaw;

    const allowedKeys = new Set([
      "profileId",
      "readOnly",
      "allowNetwork",
      "worktreeMode",
      "allowedCommandPrefixes",
      "maxCommandsPerPlan",
      "commandTimeoutMs",
      "maxStdoutBytes",
      "maxStderrBytes",
    ]);
    for (const key of Object.keys(profile)) {
      if (!allowedKeys.has(key)) {
        failValidation(`permissionProfiles[${index}] contains unknown key: ${key}`);
      }
    }

    const profileId = expectString(
      profile.profileId,
      `permissionProfiles[${index}].profileId`,
    );
    if (!PERMISSION_PROFILE_IDS.includes(profileId as PermissionProfileId)) {
      failValidation(`permissionProfiles[${index}].profileId is invalid`);
    }

    if (typeof profile.readOnly !== "boolean") {
      failValidation(`permissionProfiles[${index}].readOnly must be boolean`);
    }
    if (typeof profile.allowNetwork !== "boolean") {
      failValidation(`permissionProfiles[${index}].allowNetwork must be boolean`);
    }

    const worktreeModeRaw = expectString(
      profile.worktreeMode,
      `permissionProfiles[${index}].worktreeMode`,
    );
    if (worktreeModeRaw !== "none" && worktreeModeRaw !== "ephemeral") {
      failValidation(`permissionProfiles[${index}].worktreeMode is invalid`);
    }

    return {
      profileId: profileId as PermissionProfileId,
      readOnly: profile.readOnly,
      allowNetwork: profile.allowNetwork,
      worktreeMode: worktreeModeRaw,
      allowedCommandPrefixes: validateAllowedCommandPrefixes(
        profile.allowedCommandPrefixes,
      ),
      maxCommandsPerPlan: expectNonNegativeInteger(
        profile.maxCommandsPerPlan,
        `permissionProfiles[${index}].maxCommandsPerPlan`,
      ),
      commandTimeoutMs: expectNonNegativeInteger(
        profile.commandTimeoutMs,
        `permissionProfiles[${index}].commandTimeoutMs`,
      ),
      maxStdoutBytes: expectNonNegativeInteger(
        profile.maxStdoutBytes,
        `permissionProfiles[${index}].maxStdoutBytes`,
      ),
      maxStderrBytes: expectNonNegativeInteger(
        profile.maxStderrBytes,
        `permissionProfiles[${index}].maxStderrBytes`,
      ),
    };
  });
}

function validateProviderBindings(value: unknown): ProviderBinding[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const bindings = expectArray(value, "providerBindings");

  return bindings.map((bindingRaw, index) => {
    if (!isPlainObject(bindingRaw)) {
      failValidation(`providerBindings[${index}] must be an object`);
    }
    const binding = bindingRaw;

    const allowedKeys = new Set([
      "bindingId",
      "adapterId",
      "adapterVersion",
      "modelId",
      "temperature",
      "topP",
      "maxTokens",
      "seed",
      "timeoutMs",
      "retryMax",
      "retryBackoffMs",
    ]);
    for (const key of Object.keys(binding)) {
      if (!allowedKeys.has(key)) {
        failValidation(`providerBindings[${index}] contains unknown key: ${key}`);
      }
    }

    const adapterId = expectString(
      binding.adapterId,
      `providerBindings[${index}].adapterId`,
    );
    if (adapterId !== "openai-codex" && adapterId !== "anthropic-claude") {
      failValidation(`providerBindings[${index}].adapterId is invalid`);
    }

    if (binding.temperature !== 0) {
      failValidation(`providerBindings[${index}].temperature must be 0`);
    }
    if (binding.topP !== 1) {
      failValidation(`providerBindings[${index}].topP must be 1`);
    }

    const seed = binding.seed;
    if (seed !== null && (typeof seed !== "number" || !Number.isInteger(seed))) {
      failValidation(`providerBindings[${index}].seed must be an integer or null`);
    }

    const retryMax = expectNonNegativeInteger(
      binding.retryMax,
      `providerBindings[${index}].retryMax`,
    );
    if (retryMax !== 2) {
      failValidation(`providerBindings[${index}].retryMax must be 2`);
    }

    if (
      !Array.isArray(binding.retryBackoffMs) ||
      binding.retryBackoffMs.length !== 2 ||
      binding.retryBackoffMs[0] !== 500 ||
      binding.retryBackoffMs[1] !== 1500
    ) {
      failValidation(`providerBindings[${index}].retryBackoffMs must equal [500,1500]`);
    }

    return {
      bindingId: expectString(
        binding.bindingId,
        `providerBindings[${index}].bindingId`,
      ),
      adapterId: adapterId as ProviderBinding["adapterId"],
      adapterVersion: expectString(
        binding.adapterVersion,
        `providerBindings[${index}].adapterVersion`,
      ),
      modelId: expectString(binding.modelId, `providerBindings[${index}].modelId`),
      temperature: 0,
      topP: 1,
      maxTokens: expectPositiveInteger(
        binding.maxTokens,
        `providerBindings[${index}].maxTokens`,
      ),
      seed,
      timeoutMs: expectPositiveInteger(
        binding.timeoutMs,
        `providerBindings[${index}].timeoutMs`,
      ),
      retryMax: 2,
      retryBackoffMs: [500, 1500],
    };
  });
}

export function validateQaRunConfigV1(raw: unknown): QaRunConfigV1 {
  if (!isPlainObject(raw)) {
    failValidation("Config root must be a JSON object");
  }
  const config = raw;

  for (const key of Object.keys(config)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      failValidation(`Unknown config key: ${key}`);
    }
  }

  const schemaVersion = config.schemaVersion;
  if (schemaVersion !== undefined && schemaVersion !== "qa-run-config.v1") {
    failValidation("schemaVersion must be qa-run-config.v1");
  }

  const runMode = config.runMode;
  if (runMode !== undefined) {
    const parsedRunMode = expectString(runMode, "runMode");
    if (!RUN_MODES.includes(parsedRunMode as RunMode)) {
      failValidation("runMode is invalid");
    }
  }

  const defaultPermissionProfileId = config.defaultPermissionProfileId;
  if (defaultPermissionProfileId !== undefined) {
    const parsedDefaultProfileId = expectString(
      defaultPermissionProfileId,
      "defaultPermissionProfileId",
    );
    if (!PERMISSION_PROFILE_IDS.includes(parsedDefaultProfileId as PermissionProfileId)) {
      failValidation("defaultPermissionProfileId is invalid");
    }
  }

  if (config.maxConcurrency !== undefined) {
    expectPositiveInteger(config.maxConcurrency, "maxConcurrency");
  }

  if (config.runBudgetMaxTokens !== undefined) {
    expectPositiveInteger(config.runBudgetMaxTokens, "runBudgetMaxTokens");
  }

  if (config.repoId !== undefined) {
    expectString(config.repoId, "repoId");
  }
  if (config.repoRoot !== undefined) {
    expectString(config.repoRoot, "repoRoot");
  }
  if (config.headRef !== undefined) {
    expectString(config.headRef, "headRef");
  }
  if (config.baseRef !== undefined && config.baseRef !== null) {
    expectString(config.baseRef, "baseRef");
  }
  if (config.artifactRoot !== undefined) {
    expectString(config.artifactRoot, "artifactRoot");
  }

  const parsedRequestedLensIds = validateRequestedLensIds(config.requestedLensIds);
  const parsedLensClasses = validateLensClasses(config.allowExecutionLensClasses);
  const parsedPermissionProfiles = validatePermissionProfiles(config.permissionProfiles);
  const parsedProviderBindings = validateProviderBindings(config.providerBindings);
  const parsedCostBudget = expectOptionalNullableNumber(
    config.runBudgetMaxCostUsd,
    "runBudgetMaxCostUsd",
  );

  return {
    schemaVersion: schemaVersion as QaRunConfigV1["schemaVersion"],
    repoId: expectOptionalString(config.repoId, "repoId"),
    repoRoot: expectOptionalString(config.repoRoot, "repoRoot"),
    baseRef: expectOptionalNullableString(config.baseRef, "baseRef"),
    headRef: expectOptionalString(config.headRef, "headRef"),
    runMode: runMode as QaRunConfigV1["runMode"],
    requestedLensIds: parsedRequestedLensIds,
    maxConcurrency: config.maxConcurrency as number | undefined,
    allowExecutionLensClasses: parsedLensClasses,
    permissionProfiles: parsedPermissionProfiles,
    defaultPermissionProfileId:
      defaultPermissionProfileId as QaRunConfigV1["defaultPermissionProfileId"],
    artifactRoot: expectOptionalString(config.artifactRoot, "artifactRoot"),
    runBudgetMaxTokens: config.runBudgetMaxTokens as number | undefined,
    runBudgetMaxCostUsd: parsedCostBudget,
    providerBindings: parsedProviderBindings,
  };
}

export async function loadConfig(configPath: string): Promise<QaRunConfigV1> {
  const resolvedPath = resolve(configPath);

  let rawContent: string;
  try {
    rawContent = await readFile(resolvedPath, "utf8");
  } catch {
    throw new CliError(
      "CONFIG_READ_ERROR",
      `Unable to read config file: ${resolvedPath}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new CliError(
      "CONFIG_PARSE_ERROR",
      `Config file is not valid JSON: ${resolvedPath}`,
    );
  }

  return validateQaRunConfigV1(parsed);
}
