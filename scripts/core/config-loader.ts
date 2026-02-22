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

function ensure(
  condition: boolean,
  message: string,
): asserts condition is true {
  if (!condition) {
    throw new CliError("CONFIG_VALIDATION_ERROR", message);
  }
}

function asString(value: unknown, field: string): string {
  ensure(typeof value === "string", `${field} must be a string`);
  ensure(value.length > 0, `${field} must not be empty`);
  return value;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asString(value, field);
}

function asOptionalNullableString(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  return asString(value, field);
}

function asPositiveInteger(value: unknown, field: string): number {
  ensure(
    typeof value === "number" && Number.isInteger(value) && value > 0,
    `${field} must be a positive integer`,
  );
  return value;
}

function asNonNegativeInteger(value: unknown, field: string): number {
  ensure(
    typeof value === "number" && Number.isInteger(value) && value >= 0,
    `${field} must be a non-negative integer`,
  );
  return value;
}

function asOptionalNullableNumber(
  value: unknown,
  field: string,
): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  ensure(
    typeof value === "number" && Number.isFinite(value) && value >= 0,
    `${field} must be a non-negative finite number or null`,
  );
  return value;
}

function validateRequestedLensIds(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  ensure(Array.isArray(value), "requestedLensIds must be an array or null");
  return value.map((item, index) =>
    asString(item, `requestedLensIds[${index}]`),
  );
}

function validateLensClasses(value: unknown): LensClass[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  ensure(Array.isArray(value), "allowExecutionLensClasses must be an array");
  return value.map((item, index) => {
    const lensClass = asString(item, `allowExecutionLensClasses[${index}]`);
    ensure(
      LENS_CLASSES.includes(lensClass as LensClass),
      `allowExecutionLensClasses[${index}] is invalid`,
    );
    return lensClass as LensClass;
  });
}

function validateAllowedCommandPrefixes(
  value: unknown,
): PermissionProfile["allowedCommandPrefixes"] {
  ensure(Array.isArray(value), "allowedCommandPrefixes must be an array");
  return value.map((prefix, prefixIndex) => {
    ensure(
      Array.isArray(prefix),
      `allowedCommandPrefixes[${prefixIndex}] must be an array`,
    );
    return prefix.map((token, tokenIndex) =>
      asString(
        token,
        `allowedCommandPrefixes[${prefixIndex}][${tokenIndex}]`,
      ),
    );
  });
}

function validatePermissionProfiles(
  value: unknown,
): PermissionProfile[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  ensure(Array.isArray(value), "permissionProfiles must be an array");

  return value.map((profile, index) => {
    ensure(
      isPlainObject(profile),
      `permissionProfiles[${index}] must be an object`,
    );

    const keys = Object.keys(profile);
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
    for (const key of keys) {
      ensure(
        allowedKeys.has(key),
        `permissionProfiles[${index}] contains unknown key: ${key}`,
      );
    }

    const profileId = asString(profile.profileId, `permissionProfiles[${index}].profileId`);
    ensure(
      PERMISSION_PROFILE_IDS.includes(profileId as PermissionProfileId),
      `permissionProfiles[${index}].profileId is invalid`,
    );

    ensure(
      typeof profile.readOnly === "boolean",
      `permissionProfiles[${index}].readOnly must be boolean`,
    );
    ensure(
      typeof profile.allowNetwork === "boolean",
      `permissionProfiles[${index}].allowNetwork must be boolean`,
    );

    const worktreeMode = asString(
      profile.worktreeMode,
      `permissionProfiles[${index}].worktreeMode`,
    );
    ensure(
      worktreeMode === "none" || worktreeMode === "ephemeral",
      `permissionProfiles[${index}].worktreeMode is invalid`,
    );

    return {
      profileId: profileId as PermissionProfileId,
      readOnly: profile.readOnly,
      allowNetwork: profile.allowNetwork,
      worktreeMode,
      allowedCommandPrefixes: validateAllowedCommandPrefixes(
        profile.allowedCommandPrefixes,
      ),
      maxCommandsPerPlan: asNonNegativeInteger(
        profile.maxCommandsPerPlan,
        `permissionProfiles[${index}].maxCommandsPerPlan`,
      ),
      commandTimeoutMs: asNonNegativeInteger(
        profile.commandTimeoutMs,
        `permissionProfiles[${index}].commandTimeoutMs`,
      ),
      maxStdoutBytes: asNonNegativeInteger(
        profile.maxStdoutBytes,
        `permissionProfiles[${index}].maxStdoutBytes`,
      ),
      maxStderrBytes: asNonNegativeInteger(
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
  ensure(Array.isArray(value), "providerBindings must be an array");

  return value.map((binding, index) => {
    ensure(
      isPlainObject(binding),
      `providerBindings[${index}] must be an object`,
    );

    const keys = Object.keys(binding);
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
    for (const key of keys) {
      ensure(
        allowedKeys.has(key),
        `providerBindings[${index}] contains unknown key: ${key}`,
      );
    }

    const adapterId = asString(
      binding.adapterId,
      `providerBindings[${index}].adapterId`,
    );
    ensure(
      adapterId === "openai-codex" || adapterId === "anthropic-claude",
      `providerBindings[${index}].adapterId is invalid`,
    );

    ensure(
      binding.temperature === 0,
      `providerBindings[${index}].temperature must be 0`,
    );
    ensure(
      binding.topP === 1,
      `providerBindings[${index}].topP must be 1`,
    );

    const seed = binding.seed;
    ensure(
      seed === null || (typeof seed === "number" && Number.isInteger(seed)),
      `providerBindings[${index}].seed must be an integer or null`,
    );

    const retryMax = asNonNegativeInteger(
      binding.retryMax,
      `providerBindings[${index}].retryMax`,
    );
    ensure(
      retryMax === 2,
      `providerBindings[${index}].retryMax must be 2`,
    );

    ensure(
      Array.isArray(binding.retryBackoffMs) &&
        binding.retryBackoffMs.length === 2 &&
        binding.retryBackoffMs[0] === 500 &&
        binding.retryBackoffMs[1] === 1500,
      `providerBindings[${index}].retryBackoffMs must equal [500,1500]`,
    );

    return {
      bindingId: asString(binding.bindingId, `providerBindings[${index}].bindingId`),
      adapterId: adapterId as ProviderBinding["adapterId"],
      adapterVersion: asString(
        binding.adapterVersion,
        `providerBindings[${index}].adapterVersion`,
      ),
      modelId: asString(binding.modelId, `providerBindings[${index}].modelId`),
      temperature: 0,
      topP: 1,
      maxTokens: asPositiveInteger(
        binding.maxTokens,
        `providerBindings[${index}].maxTokens`,
      ),
      seed,
      timeoutMs: asPositiveInteger(
        binding.timeoutMs,
        `providerBindings[${index}].timeoutMs`,
      ),
      retryMax: 2,
      retryBackoffMs: [500, 1500],
    };
  });
}

export function validateQaRunConfigV1(raw: unknown): QaRunConfigV1 {
  ensure(isPlainObject(raw), "Config root must be a JSON object");

  for (const key of Object.keys(raw)) {
    ensure(ALLOWED_TOP_LEVEL_KEYS.has(key), `Unknown config key: ${key}`);
  }

  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== undefined) {
    ensure(
      schemaVersion === "qa-run-config.v1",
      "schemaVersion must be qa-run-config.v1",
    );
  }

  const runMode = raw.runMode;
  if (runMode !== undefined) {
    const parsedRunMode = asString(runMode, "runMode");
    ensure(RUN_MODES.includes(parsedRunMode as RunMode), "runMode is invalid");
  }

  const defaultPermissionProfileId = raw.defaultPermissionProfileId;
  if (defaultPermissionProfileId !== undefined) {
    const parsedDefaultProfileId = asString(
      defaultPermissionProfileId,
      "defaultPermissionProfileId",
    );
    ensure(
      PERMISSION_PROFILE_IDS.includes(parsedDefaultProfileId as PermissionProfileId),
      "defaultPermissionProfileId is invalid",
    );
  }

  const maxConcurrency = raw.maxConcurrency;
  if (maxConcurrency !== undefined) {
    asPositiveInteger(maxConcurrency, "maxConcurrency");
  }

  const runBudgetMaxTokens = raw.runBudgetMaxTokens;
  if (runBudgetMaxTokens !== undefined) {
    asPositiveInteger(runBudgetMaxTokens, "runBudgetMaxTokens");
  }

  if (raw.repoId !== undefined) {
    asString(raw.repoId, "repoId");
  }
  if (raw.repoRoot !== undefined) {
    asString(raw.repoRoot, "repoRoot");
  }
  if (raw.headRef !== undefined) {
    asString(raw.headRef, "headRef");
  }
  if (raw.baseRef !== undefined && raw.baseRef !== null) {
    asString(raw.baseRef, "baseRef");
  }
  if (raw.artifactRoot !== undefined) {
    asString(raw.artifactRoot, "artifactRoot");
  }

  const parsedRequestedLensIds = validateRequestedLensIds(raw.requestedLensIds);
  const parsedLensClasses = validateLensClasses(raw.allowExecutionLensClasses);
  const parsedPermissionProfiles = validatePermissionProfiles(raw.permissionProfiles);
  const parsedProviderBindings = validateProviderBindings(raw.providerBindings);
  const parsedCostBudget = asOptionalNullableNumber(
    raw.runBudgetMaxCostUsd,
    "runBudgetMaxCostUsd",
  );

  return {
    schemaVersion: schemaVersion as QaRunConfigV1["schemaVersion"],
    repoId: asOptionalString(raw.repoId, "repoId"),
    repoRoot: asOptionalString(raw.repoRoot, "repoRoot"),
    baseRef: asOptionalNullableString(raw.baseRef, "baseRef"),
    headRef: asOptionalString(raw.headRef, "headRef"),
    runMode: runMode as QaRunConfigV1["runMode"],
    requestedLensIds: parsedRequestedLensIds,
    maxConcurrency: maxConcurrency as number | undefined,
    allowExecutionLensClasses: parsedLensClasses,
    permissionProfiles: parsedPermissionProfiles,
    defaultPermissionProfileId:
      defaultPermissionProfileId as QaRunConfigV1["defaultPermissionProfileId"],
    artifactRoot: asOptionalString(raw.artifactRoot, "artifactRoot"),
    runBudgetMaxTokens: runBudgetMaxTokens as number | undefined,
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
