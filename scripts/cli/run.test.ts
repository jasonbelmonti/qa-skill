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

function runQa(args: string[], options: { cwd?: string } = {}): ProcessResult {
  const result = Bun.spawnSync(["bun", "run", "qa:run", "--", ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: decode(result.stdout),
    stderr: decode(result.stderr),
  };
}

function parseJsonLines(output: string): Record<string, unknown>[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function parseLastJsonLine(output: string): Record<string, unknown> {
  const lines = parseJsonLines(output);
  const jsonLine = lines.at(-1);

  if (!jsonLine) {
    throw new Error(`No JSON payload found in output: ${output}`);
  }

  return jsonLine;
}

function runGit(repoRoot: string, args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", repoRoot, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${decode(result.stderr).trim()}`,
    );
  }
}

async function initFallbackRepo(repoRoot: string): Promise<void> {
  await mkdir(repoRoot, { recursive: true });
  runGit(repoRoot, ["init"]);
  runGit(repoRoot, ["config", "user.email", "qa-skill@example.com"]);
  runGit(repoRoot, ["config", "user.name", "QA Skill"]);

  await writeFile(join(repoRoot, "README.md"), "hello\n", "utf8");
  runGit(repoRoot, ["add", "README.md"]);
  runGit(repoRoot, ["commit", "-m", "init"]);

  // Simulate a fetched remote main branch while origin/HEAD is unavailable.
  runGit(repoRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "qa-skill-"));
  try {
    return await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("qa:run writes input.normalized.json + trace.json and returns success output", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");
    await writeFile(configPath, '{"baseRef":"HEAD"}\n', "utf8");

    const result = runQa(["--config", configPath, "--out", outPath]);

    expect(result.exitCode).toBe(0);
    const stdoutPayload = parseLastJsonLine(result.stdout);
    expect(stdoutPayload.status).toBe("ok");
    expect(stdoutPayload.artifactPath).toBe(resolve(outPath, "input.normalized.json"));
    expect(stdoutPayload.configHash).toMatch(/^[a-f0-9]{64}$/);

    const artifactContent = await readFile(
      resolve(outPath, "input.normalized.json"),
      "utf8",
    );
    const artifactPayload = JSON.parse(artifactContent);
    expect(artifactPayload.configHash).toBe(stdoutPayload.configHash);

    const traceContent = await readFile(resolve(outPath, "trace.json"), "utf8");
    const tracePayload = JSON.parse(traceContent);
    expect(tracePayload.baseRefResolution.errorCode).toBeNull();
    expect(tracePayload.baseRefResolution.resolvedBaseRef).toBe("HEAD");
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
          baseRef: "HEAD",
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

    const firstPayload = parseLastJsonLine(first.stdout);
    const secondPayload = parseLastJsonLine(second.stdout);

    expect(firstPayload.configHash).toBe(secondPayload.configHash);

    const firstArtifact = await readFile(resolve(outA, "input.normalized.json"), "utf8");
    const secondArtifact = await readFile(resolve(outB, "input.normalized.json"), "utf8");
    const firstTrace = await readFile(resolve(outA, "trace.json"), "utf8");
    const secondTrace = await readFile(resolve(outB, "trace.json"), "utf8");

    expect(firstArtifact).toBe(secondArtifact);
    expect(firstTrace).toBe(secondTrace);
  });
});

test("qa:run emits warning lines before success when baseRef falls back to origin/main", async () => {
  await withTempDir(async (tempDir) => {
    const repoRoot = join(tempDir, "fallback-repo");
    await initFallbackRepo(repoRoot);

    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");

    await writeFile(
      configPath,
      JSON.stringify(
        {
          schemaVersion: "qa-run-config.v1",
          repoRoot,
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = runQa(["--config", configPath, "--out", outPath]);
    expect(result.exitCode).toBe(0);

    const lines = parseJsonLines(result.stdout);
    expect(lines).toHaveLength(3);

    expect(lines[0]).toEqual({
      code: "BASE_REF_FALLBACK_ORIGIN_HEAD_UNAVAILABLE",
      level: "warning",
      phase: "base_ref_resolution",
    });
    expect(lines[1]).toEqual({
      code: "BASE_REF_FALLBACK_ORIGIN_MAIN",
      level: "warning",
      phase: "base_ref_resolution",
    });
    expect(lines[2]?.status).toBe("ok");

    const trace = JSON.parse(await readFile(resolve(outPath, "trace.json"), "utf8"));
    expect(trace.baseRefResolution.warningCodes).toEqual([
      "BASE_REF_FALLBACK_ORIGIN_HEAD_UNAVAILABLE",
      "BASE_REF_FALLBACK_ORIGIN_MAIN",
    ]);
    expect(trace.baseRefResolution.errorCode).toBeNull();
    expect(trace.baseRefResolution.resolvedBaseRef).toBe("origin/main");
  });
});

test("qa:run returns usage error when required args are missing", () => {
  const result = runQa([]);

  expect(result.exitCode).toBe(2);
  const stdoutPayload = parseLastJsonLine(result.stdout);
  expect(stdoutPayload.code).toBe("USAGE_ERROR");
});

test("qa:run returns parse error for invalid JSON config", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");
    await writeFile(configPath, "{\n", "utf8");

    const result = runQa(["--config", configPath, "--out", outPath]);
    expect(result.exitCode).toBe(3);

    const stdoutPayload = parseLastJsonLine(result.stdout);
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

    const stdoutPayload = parseLastJsonLine(result.stdout);
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

    const stdoutPayload = parseLastJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("CONFIG_VALIDATION_ERROR");
  });
});

test("qa:run returns error when output directory is non-empty", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");
    await writeFile(configPath, '{"baseRef":"HEAD"}\n', "utf8");

    await mkdir(outPath, { recursive: true });
    await writeFile(join(outPath, "existing-file.txt"), "existing\n", "utf8");

    const result = runQa(["--config", configPath, "--out", outPath]);
    expect(result.exitCode).toBe(4);

    const stdoutPayload = parseLastJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("OUT_DIR_NON_EMPTY");
  });
});

test("qa:run returns usage error for unknown flags", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");
    await writeFile(configPath, '{}\n', "utf8");

    const result = runQa([
      "--config",
      configPath,
      "--out",
      outPath,
      "--mystery-flag",
    ]);

    expect(result.exitCode).toBe(2);
    const stdoutPayload = parseLastJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("USAGE_ERROR");
  });
});

test("qa:run returns read error for missing config file", async () => {
  await withTempDir(async (tempDir) => {
    const missingConfigPath = join(tempDir, "missing-config.json");
    const outPath = join(tempDir, "run-a");

    const result = runQa(["--config", missingConfigPath, "--out", outPath]);
    expect(result.exitCode).toBe(3);

    const stdoutPayload = parseLastJsonLine(result.stdout);
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

    const stdoutPayload = parseLastJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("CONFIG_VALIDATION_ERROR");
  });
});

test("qa:run writes trace and deterministic code when configured baseRef is invalid", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const outPath = join(tempDir, "run-a");

    await writeFile(
      configPath,
      JSON.stringify(
        {
          schemaVersion: "qa-run-config.v1",
          baseRef: "refs/heads/does-not-exist",
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = runQa(["--config", configPath, "--out", outPath]);

    expect(result.exitCode).toBe(3);
    const stdoutPayload = parseLastJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(stdoutPayload.deterministicCode).toBe("BASE_REF_CONFIGURED_NOT_FOUND");

    const trace = JSON.parse(await readFile(resolve(outPath, "trace.json"), "utf8"));
    expect(trace).toEqual({
      schemaVersion: "trace.v1",
      baseRefResolution: {
        requestedBaseRef: "refs/heads/does-not-exist",
        resolvedBaseRef: null,
        warningCodes: [],
        errorCode: "BASE_REF_CONFIGURED_NOT_FOUND",
      },
    });
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
    const stdoutPayload = parseLastJsonLine(result.stdout);
    expect(stdoutPayload.code).toBe("ARTIFACT_WRITE_ERROR");
  });
});
