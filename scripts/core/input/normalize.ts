import { basename, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";

import type { QaRunConfigV1 } from "../../contracts/config";
import type {
  LensClass,
  PermissionProfile,
  PermissionProfileId,
  ProviderBinding,
  SkillInput,
} from "../../contracts/skill-input";
import { hashCanonical } from "../../utils/hash";
import { CliError } from "../errors";
import { assertSchema } from "../schema/validate";
import {
  DEFAULT_ARTIFACT_ROOT,
  DEFAULT_BASE_REF,
  DEFAULT_HEAD_REF,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_PERMISSION_PROFILE_ID,
  DEFAULT_READ_ONLY_PERMISSION_PROFILE,
  DEFAULT_REQUESTED_LENS_IDS,
  DEFAULT_RUN_BUDGET_MAX_COST_USD,
  DEFAULT_RUN_BUDGET_MAX_TOKENS,
  DEFAULT_RUN_MODE,
  DEFAULT_VCS,
} from "./constants";
import type { NormalizeOptions } from "./types";

function clonePermissionProfile(profile: PermissionProfile): PermissionProfile {
  return {
    profileId: profile.profileId,
    readOnly: profile.readOnly,
    allowNetwork: profile.allowNetwork,
    worktreeMode: profile.worktreeMode,
    allowedCommandPrefixes: profile.allowedCommandPrefixes.map((prefix) => [
      ...prefix,
    ]),
    maxCommandsPerPlan: profile.maxCommandsPerPlan,
    commandTimeoutMs: profile.commandTimeoutMs,
    maxStdoutBytes: profile.maxStdoutBytes,
    maxStderrBytes: profile.maxStderrBytes,
  };
}

function cloneProviderBinding(binding: ProviderBinding): ProviderBinding {
  return {
    bindingId: binding.bindingId,
    adapterId: binding.adapterId,
    adapterVersion: binding.adapterVersion,
    modelId: binding.modelId,
    temperature: 0,
    topP: 1,
    maxTokens: binding.maxTokens,
    seed: binding.seed,
    timeoutMs: binding.timeoutMs,
    retryMax: 2,
    retryBackoffMs: [500, 1500],
  };
}

function normalizeRemotePath(pathValue: string): string | null {
  const trimmed = pathValue
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeRepoIdCandidate(value: string): string {
  return value
    .trim()
    .replace(/[:\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deriveRepoIdFromRepoRoot(repoRoot: string): string {
  const trimmedRoot = repoRoot.trim().replace(/[\\/]+$/g, "");

  const base = basename(trimmedRoot);
  const sanitizedBase = sanitizeRepoIdCandidate(base);
  if (sanitizedBase.length > 0) {
    return sanitizedBase;
  }

  const sanitizedRoot = sanitizeRepoIdCandidate(
    trimmedRoot.replace(/^[\\/]+/, ""),
  );

  if (sanitizedRoot.length > 0) {
    return sanitizedRoot;
  }

  return "repo-root";
}

export function deriveRepoIdFromRemoteUrl(
  remoteUrl: string | null,
  repoRoot: string,
): string {
  if (remoteUrl) {
    const trimmed = remoteUrl.trim();

    const scpLikeMatch = trimmed.match(/^[^@]+@[^:]+:(.+)$/);
    const scpPath = scpLikeMatch?.[1];
    if (scpPath) {
      const parsed = normalizeRemotePath(scpPath);
      if (parsed) {
        return parsed;
      }
    }

    try {
      const url = new URL(trimmed);
      const parsed = normalizeRemotePath(url.pathname);
      if (parsed) {
        return parsed;
      }
    } catch {
      const direct = normalizeRemotePath(trimmed);
      if (direct) {
        return direct;
      }
    }
  }

  return deriveRepoIdFromRepoRoot(repoRoot);
}

export async function defaultGetOriginRemoteUrl(
  repoRoot: string,
): Promise<string | null> {
  const processResult = Bun.spawnSync(
    ["git", "-C", repoRoot, "remote", "get-url", "origin"],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (processResult.exitCode !== 0) {
    return null;
  }

  const remoteUrl = new TextDecoder().decode(processResult.stdout).trim();
  return remoteUrl.length > 0 ? remoteUrl : null;
}

function ensureUniqueProfileIds(profiles: PermissionProfile[]): void {
  const seen = new Set<PermissionProfileId>();
  for (const profile of profiles) {
    if (seen.has(profile.profileId)) {
      throw new CliError(
        "CONFIG_VALIDATION_ERROR",
        `Duplicate permission profile id: ${profile.profileId}`,
      );
    }
    seen.add(profile.profileId);
  }
}

function ensureDefaultPermissionProfilePresent(
  profiles: PermissionProfile[],
  defaultProfileId: PermissionProfileId,
): void {
  if (!profiles.some((profile) => profile.profileId === defaultProfileId)) {
    throw new CliError(
      "CONFIG_VALIDATION_ERROR",
      `defaultPermissionProfileId not found in permissionProfiles: ${defaultProfileId}`,
    );
  }
}

export async function normalizeConfigToSkillInput(
  config: QaRunConfigV1,
  options: NormalizeOptions = {},
): Promise<SkillInput> {
  const cwd = options.cwd ?? process.cwd();
  const resolveRealpath = options.resolveRealpath ?? realpath;
  const getOriginRemoteUrl =
    options.getOriginRemoteUrl ?? defaultGetOriginRemoteUrl;

  const repoRootInput = resolve(cwd, config.repoRoot ?? ".");
  let normalizedRepoRoot: string;
  try {
    normalizedRepoRoot = await resolveRealpath(repoRootInput);
  } catch {
    throw new CliError(
      "CONFIG_VALIDATION_ERROR",
      `repoRoot does not exist or is not accessible: ${repoRootInput}`,
    );
  }

  let repoRootStats: Awaited<ReturnType<typeof stat>>;
  try {
    repoRootStats = await stat(normalizedRepoRoot);
  } catch {
    throw new CliError(
      "CONFIG_VALIDATION_ERROR",
      `repoRoot does not exist or is not accessible: ${repoRootInput}`,
    );
  }

  if (!repoRootStats.isDirectory()) {
    throw new CliError(
      "CONFIG_VALIDATION_ERROR",
      `repoRoot is not a directory: ${repoRootInput}`,
    );
  }

  let remoteUrl: string | null = null;
  try {
    remoteUrl = await getOriginRemoteUrl(normalizedRepoRoot);
  } catch {
    remoteUrl = null;
  }
  const repoId =
    config.repoId ?? deriveRepoIdFromRemoteUrl(remoteUrl, normalizedRepoRoot);

  const permissionProfiles = (
    config.permissionProfiles ?? []
  ).map(clonePermissionProfile);

  if (
    !permissionProfiles.some(
      (profile) => profile.profileId === DEFAULT_PERMISSION_PROFILE_ID,
    )
  ) {
    permissionProfiles.push(clonePermissionProfile(DEFAULT_READ_ONLY_PERMISSION_PROFILE));
  }

  ensureUniqueProfileIds(permissionProfiles);

  const defaultPermissionProfileId =
    config.defaultPermissionProfileId ?? DEFAULT_PERMISSION_PROFILE_ID;

  ensureDefaultPermissionProfilePresent(
    permissionProfiles,
    defaultPermissionProfileId,
  );

  const normalizedWithoutHash: Omit<SkillInput, "configHash"> = {
    schemaVersion: "skill-input.v1",
    repoId,
    repoRoot: normalizedRepoRoot,
    vcs: DEFAULT_VCS,
    baseRef: config.baseRef ?? DEFAULT_BASE_REF,
    headRef: config.headRef ?? DEFAULT_HEAD_REF,
    runMode: config.runMode ?? DEFAULT_RUN_MODE,
    requestedLensIds: config.requestedLensIds ?? DEFAULT_REQUESTED_LENS_IDS,
    maxConcurrency: config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
    allowExecutionLensClasses:
      (config.allowExecutionLensClasses as LensClass[] | undefined) ?? [],
    permissionProfiles,
    defaultPermissionProfileId,
    artifactRoot: config.artifactRoot ?? DEFAULT_ARTIFACT_ROOT,
    runBudgetMaxTokens:
      config.runBudgetMaxTokens ?? DEFAULT_RUN_BUDGET_MAX_TOKENS,
    runBudgetMaxCostUsd:
      config.runBudgetMaxCostUsd === undefined
        ? DEFAULT_RUN_BUDGET_MAX_COST_USD
        : config.runBudgetMaxCostUsd,
    providerBindings: (config.providerBindings ?? []).map(cloneProviderBinding),
  };

  const configHash = hashCanonical(normalizedWithoutHash);

  const normalizedInput: SkillInput = {
    ...normalizedWithoutHash,
    configHash,
  };

  assertSchema("skill-input.v1", normalizedInput, "ARTIFACT_SCHEMA_INVALID");

  return normalizedInput;
}
