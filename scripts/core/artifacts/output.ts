import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { SkillInput } from "../../contracts/skill-input";
import { stableStringify } from "../../utils/canonical-json";
import { CliError } from "../errors";

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

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

  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    if (hasErrorCode(error, "ENOENT")) {
      try {
        await mkdir(resolvedOutDir, { recursive: true });
      } catch {
        throw new CliError(
          "ARTIFACT_WRITE_ERROR",
          `Unable to create output directory: ${resolvedOutDir}`,
        );
      }
      return resolvedOutDir;
    }

    throw new CliError(
      "ARTIFACT_WRITE_ERROR",
      `Unable to access output directory: ${resolvedOutDir}`,
    );
  }

  try {
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

    throw new CliError(
      "ARTIFACT_WRITE_ERROR",
      `Unable to inspect output directory: ${resolvedOutDir}`,
    );
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
