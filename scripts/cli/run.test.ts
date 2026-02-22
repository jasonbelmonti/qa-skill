import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function decode(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function runQa(args: string[]): ProcessResult {
  const result = Bun.spawnSync(["bun", "run", "qa:run", "--", ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: decode(result.stdout),
    stderr: decode(result.stderr),
  };
}

function parseJsonLine(output: string): Record<string, unknown> {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith("{"));

  if (!jsonLine) {
    throw new Error(`No JSON payload found in output: ${output}`);
  }

  return JSON.parse(jsonLine) as Record<string, unknown>;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "qa-skill-"));
  try {
    return await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("qa:run writes input.normalized.json and returns success output", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");
    await writeFile(configPath, "{}\n", "utf8");

    const result = runQa(["--config", configPath, "--out", outPath]);

    expect(result.exitCode).toBe(0);
    const stdoutPayload = parseJsonLine(result.stdout);
    expect(stdoutPayload.status).toBe("ok");
    expect(stdoutPayload.artifactPath).toBe(resolve(outPath, "input.normalized.json"));
    expect(stdoutPayload.configHash).toMatch(/^[a-f0-9]{64}$/);

    const artifactContent = await readFile(
      resolve(outPath, "input.normalized.json"),
      "utf8",
    );
    const artifactPayload = JSON.parse(artifactContent);
    expect(artifactPayload.configHash).toBe(stdoutPayload.configHash);
  });
});

test("qa:run is deterministic across repeated runs", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outA = join(tempDir, "run-a");
    const outB = join(tempDir, "run-b");

    await writeFile(
      configPath,
      JSON.stringify(
        {
          runMode: "strict",
          maxConcurrency: 4,
        },
        null,
        2,
      ),
      "utf8",
    );

    const first = runQa(["--config", configPath, "--out", outA]);
    const second = runQa(["--config", configPath, "--out", outB]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);

    const firstPayload = parseJsonLine(first.stdout);
    const secondPayload = parseJsonLine(second.stdout);

    expect(firstPayload.configHash).toBe(secondPayload.configHash);

    const firstArtifact = await readFile(resolve(outA, "input.normalized.json"), "utf8");
    const secondArtifact = await readFile(resolve(outB, "input.normalized.json"), "utf8");

    expect(firstArtifact).toBe(secondArtifact);
  });
});

test("qa:run returns usage error when required args are missing", () => {
  const result = runQa([]);

  expect(result.exitCode).toBe(2);
  const stdoutPayload = parseJsonLine(result.stdout);
  expect(stdoutPayload.code).toBe("USAGE_ERROR");
});

test("qa:run returns parse error for invalid JSON config", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");
    await writeFile(configPath, "{\n", "utf8");

    const result = runQa(["--config", configPath, "--out", outPath]);
    expect(result.exitCode).toBe(3);

    const stdoutPayload = parseJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("CONFIG_PARSE_ERROR");
  });
});

test("qa:run returns validation error for invalid config values", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");
    await writeFile(configPath, '{"maxConcurrency":"4"}\n', "utf8");

    const result = runQa(["--config", configPath, "--out", outPath]);
    expect(result.exitCode).toBe(3);

    const stdoutPayload = parseJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("CONFIG_VALIDATION_ERROR");
  });
});

test("qa:run returns validation error for non-positive maxConcurrency", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");
    await writeFile(configPath, '{"maxConcurrency":0}\n', "utf8");

    const result = runQa(["--config", configPath, "--out", outPath]);
    expect(result.exitCode).toBe(3);

    const stdoutPayload = parseJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("CONFIG_VALIDATION_ERROR");
  });
});

test("qa:run returns error when output directory is non-empty", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");
    await writeFile(configPath, "{}\n", "utf8");

    await mkdir(outPath, { recursive: true });
    await writeFile(join(outPath, "existing-file.txt"), "existing\n", "utf8");

    const result = runQa(["--config", configPath, "--out", outPath]);
    expect(result.exitCode).toBe(4);

    const stdoutPayload = parseJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("OUT_DIR_NON_EMPTY");
  });
});

test("qa:run returns usage error for unknown flags", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");
    await writeFile(configPath, "{}\n", "utf8");

    const result = runQa([
      "--config",
      configPath,
      "--out",
      outPath,
      "--mystery-flag",
    ]);

    expect(result.exitCode).toBe(2);
    const stdoutPayload = parseJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("USAGE_ERROR");
  });
});

test("qa:run returns read error for missing config file", async () => {
  await withTempDir(async (tempDir) => {
    const missingConfigPath = join(tempDir, "missing-config.json");
    const outPath = join(tempDir, "run-a");

    const result = runQa(["--config", missingConfigPath, "--out", outPath]);
    expect(result.exitCode).toBe(3);

    const stdoutPayload = parseJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("CONFIG_READ_ERROR");
  });
});

test("qa:run returns validation error for invalid repoRoot path", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");
    await writeFile(configPath, '{"repoRoot":"/definitely/not/here"}\n', "utf8");

    const result = runQa(["--config", configPath, "--out", outPath]);
    expect(result.exitCode).toBe(3);

    const stdoutPayload = parseJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("CONFIG_VALIDATION_ERROR");
  });
});

test("qa:run returns artifact write error when output path cannot be created", async () => {
  if (process.platform === "win32") {
    return;
  }

  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    await writeFile(configPath, "{}\n", "utf8");

    const result = runQa([
      "--config",
      configPath,
      "--out",
      "/dev/null/qa-skill-out",
    ]);

    expect(result.exitCode).toBe(5);
    const stdoutPayload = parseJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("ARTIFACT_WRITE_ERROR");
  });
});
