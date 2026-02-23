import { resolve } from "node:path";

import type { BaseRefWarningCode } from "../contracts/error-codes";
import { stableStringify } from "../utils/canonical-json";
import { loadConfig } from "../core/config/loader";
import { formatCliErrorLine, CliError, toCliError } from "../core/errors";
import { applyContextBounds } from "../core/context/bounds";
import { classifyChangeSurface } from "../core/git/change-surface-classifier";
import { collectDiff } from "../core/git/diff-collector";
import { DiffCollectorError } from "../core/git/diff-types";
import { BaseRefResolutionError } from "../core/git/types";
import { normalizeConfigForRun } from "../core/input/normalize";
import { loadLensRegistry } from "../lenses/loader";
import { resolveRequestedLensIds } from "../lenses/requested-lens-resolver";
import {
  prepareOutputDirectory,
  writeNormalizedInputArtifact,
  writeTraceArtifact,
} from "../core/artifacts/output";

interface CliArgs {
  configPath: string;
  outDir: string;
}

function usageMessage(): string {
  return "Usage: bun run qa:run -- --config <path> --out <runDir>";
}

function emitBaseRefWarningLines(warningCodes: readonly BaseRefWarningCode[]): void {
  for (const code of warningCodes) {
    process.stdout.write(
      `${stableStringify({
        level: "warning",
        phase: "base_ref_resolution",
        code,
      })}\n`,
    );
  }
}

export function parseCliArgs(args: string[]): CliArgs {
  let configPath: string | null = null;
  let outDir: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--config") {
      const value = args[index + 1];
      if (!value) {
        throw new CliError("USAGE_ERROR", usageMessage());
      }
      if (configPath !== null) {
        throw new CliError("USAGE_ERROR", "Duplicate --config argument");
      }
      configPath = value;
      index += 1;
      continue;
    }

    if (arg === "--out") {
      const value = args[index + 1];
      if (!value) {
        throw new CliError("USAGE_ERROR", usageMessage());
      }
      if (outDir !== null) {
        throw new CliError("USAGE_ERROR", "Duplicate --out argument");
      }
      outDir = value;
      index += 1;
      continue;
    }

    if (arg === "--help") {
      throw new CliError("USAGE_ERROR", usageMessage());
    }

    throw new CliError("USAGE_ERROR", `Unknown argument: ${arg}`);
  }

  if (configPath === null || outDir === null) {
    throw new CliError("USAGE_ERROR", usageMessage());
  }

  return { configPath, outDir };
}

export async function runCli(args: string[]): Promise<number> {
  let outDir: string | null = null;

  try {
    const parsedArgs = parseCliArgs(args);
    const config = await loadConfig(resolve(parsedArgs.configPath));

    outDir = await prepareOutputDirectory(parsedArgs.outDir);

    const normalized = await normalizeConfigForRun(config);
    if (normalized.input.baseRef === null) {
      throw new CliError(
        "CONFIG_VALIDATION_ERROR",
        "Normalized input is missing resolved baseRef",
      );
    }

    const registry = await loadLensRegistry();
    resolveRequestedLensIds(registry, normalized.input.requestedLensIds);

    const diff = await collectDiff(
      normalized.input.repoRoot,
      normalized.input.baseRef,
      normalized.input.headRef,
    );
    const changeSurface = classifyChangeSurface(diff);
    const contextBounds = applyContextBounds(diff);

    const artifactPath = await writeNormalizedInputArtifact(outDir, normalized.input);
    await writeTraceArtifact(outDir, {
      ...normalized.trace,
      diffAnalysis: {
        diff,
        changeSurface,
        contextBounds,
      },
    });

    emitBaseRefWarningLines(normalized.trace.baseRefResolution.warningCodes);

    const successLine = stableStringify({
      status: "ok",
      artifactPath,
      configHash: normalized.input.configHash,
    });

    process.stdout.write(`${successLine}\n`);
    return 0;
  } catch (error) {
    if (error instanceof BaseRefResolutionError) {
      if (outDir !== null) {
        try {
          await writeTraceArtifact(outDir, error.toTraceArtifact());
        } catch (traceWriteError) {
          const writeError = toCliError(traceWriteError);
          process.stdout.write(formatCliErrorLine(writeError));
          return writeError.exitCode;
        }
      }

      emitBaseRefWarningLines(error.warningCodes);

      const cliError = new CliError("CONFIG_VALIDATION_ERROR", error.message, {
        deterministicCode: error.deterministicCode,
      });
      process.stdout.write(formatCliErrorLine(cliError));
      return cliError.exitCode;
    }

    if (error instanceof DiffCollectorError) {
      const cliError = new CliError("CONFIG_VALIDATION_ERROR", error.message, {
        deterministicCode: error.deterministicCode,
      });
      process.stdout.write(formatCliErrorLine(cliError));
      return cliError.exitCode;
    }

    const cliError = toCliError(error);
    process.stdout.write(formatCliErrorLine(cliError));
    return cliError.exitCode;
  }
}

if (import.meta.main) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
