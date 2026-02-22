import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { SkillInput } from "../contracts/skill-input";
import { stableStringify } from "./canonical-json";
import { CliError } from "./errors";

export async function prepareOutputDirectory(outDir: string): Promise<string> {
  const resolvedOutDir = resolve(outDir);

  try {
    const stats = await stat(resolvedOutDir);
    if (!stats.isDirectory()) {
      throw new CliError(
        "OUT_DIR_NON_EMPTY",
        `Output path exists and is not a directory: ${resolvedOutDir}`,
      );
    }

    const entries = await readdir(resolvedOutDir);
    if (entries.length > 0) {
      throw new CliError(
        "OUT_DIR_NON_EMPTY",
        `Output directory is not empty: ${resolvedOutDir}`,
      );
    }
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    await mkdir(resolvedOutDir, { recursive: true });
  }

  return resolvedOutDir;
}

export async function writeNormalizedInputArtifact(
  outDir: string,
  input: SkillInput,
): Promise<string> {
  const artifactPath = join(outDir, "input.normalized.json");
  const content = `${stableStringify(input, { pretty: true })}\n`;

  try {
    await writeFile(artifactPath, content, "utf8");
  } catch {
    throw new CliError(
      "ARTIFACT_WRITE_ERROR",
      `Unable to write artifact file: ${artifactPath}`,
    );
  }

  return artifactPath;
}
