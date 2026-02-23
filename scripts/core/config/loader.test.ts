import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CliError } from "../errors";
import { loadConfig } from "./loader";

async function withTempDir<T>(fn: (tempDir: string) => Promise<T>): Promise<T> {
  const testDir = await mkdtemp(join(tmpdir(), "qa-skill-loader-"));
  try {
    return await fn(testDir);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}

test("loadConfig accepts a valid config payload", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    const payload = {
      schemaVersion: "qa-run-config.v1",
      runMode: "strict",
      maxConcurrency: 4,
      runBudgetMaxCostUsd: null,
    };

    await writeFile(configPath, JSON.stringify(payload, null, 2), "utf8");
    const config = await loadConfig(configPath);

    expect(config).toEqual(payload);
  });
});

test("loadConfig returns CONFIG_VALIDATION_ERROR for unknown config keys", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    await writeFile(configPath, '{"mystery":true}\n', "utf8");

    try {
      await loadConfig(configPath);
      throw new Error("Expected loadConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cliError = error as CliError;
      expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
    }
  });
});

test("loadConfig returns CONFIG_VALIDATION_ERROR for invalid nullable budget", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    await writeFile(configPath, '{"runBudgetMaxCostUsd":-1}\n', "utf8");

    try {
      await loadConfig(configPath);
      throw new Error("Expected loadConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cliError = error as CliError;
      expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
    }
  });
});

test("loadConfig validates provider binding retry backoff tuple", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          providerBindings: [
            {
              bindingId: "binding-primary",
              adapterId: "openai-codex",
              adapterVersion: "2026-02-01",
              modelId: "o4-mini",
              temperature: 0,
              topP: 1,
              maxTokens: 2048,
              seed: null,
              timeoutMs: 60000,
              retryMax: 2,
              retryBackoffMs: [100, 200],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    try {
      await loadConfig(configPath);
      throw new Error("Expected loadConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cliError = error as CliError;
      expect(cliError.code).toBe("CONFIG_VALIDATION_ERROR");
    }
  });
});

test("loadConfig keeps payload deterministic across repeated reads", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = join(tempDir, "config.json");
    await writeFile(configPath, '{"runMode":"strict","maxConcurrency":4}\n', "utf8");

    const first = await loadConfig(configPath);
    const second = await loadConfig(configPath);

    expect(first).toEqual(second);

    const raw = await readFile(configPath, "utf8");
    expect(raw).toContain("runMode");
  });
});
