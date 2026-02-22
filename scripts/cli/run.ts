import { resolve } from "node:path";

import { stableStringify } from "../utils/canonical-json";
import { loadConfig } from "../core/config/loader";
import { formatCliErrorLine, CliError, toCliError } from "../core/errors";
import { normalizeConfigToSkillInput } from "../core/input/normalize";
import {
  prepareOutputDirectory,
  writeNormalizedInputArtifact,
} from "../core/artifacts/output";

interface CliArgs {
  configPath: string;
  outDir: string;
}

function usageMessage(): string {
  return "Usage: bun run qa:run -- --config <path> --out <runDir>";
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
  try {
    const parsedArgs = parseCliArgs(args);
    const config = await loadConfig(resolve(parsedArgs.configPath));
    const normalizedInput = await normalizeConfigToSkillInput(config);
    const outDir = await prepareOutputDirectory(parsedArgs.outDir);
    const artifactPath = await writeNormalizedInputArtifact(outDir, normalizedInput);

    const successLine = stableStringify({
      status: "ok",
      artifactPath,
      configHash: normalizedInput.configHash,
    });

    process.stdout.write(`${successLine}\n`);
    return 0;
  } catch (error) {
    const cliError = toCliError(error);
    process.stdout.write(formatCliErrorLine(cliError));
    return cliError.exitCode;
  }
}

if (import.meta.main) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
