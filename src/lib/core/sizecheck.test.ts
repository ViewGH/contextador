import { test, expect } from "bun:test";
import { shouldUseContextador } from "./sizecheck";
import { loadConfig } from "./projectconfig";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const TEST_ROOT = "/tmp/contextador-sizecheck-test";

test("shouldUseContextador returns false for small repo", async () => {
  await mkdir(join(TEST_ROOT, "src"), { recursive: true });
  await writeFile(join(TEST_ROOT, "src/main.ts"), "console.log('hi')");
  await writeFile(join(TEST_ROOT, "src/utils.ts"), "export {}");

  const result = await shouldUseContextador(TEST_ROOT);
  expect(result.use).toBe(false);
  expect(result.fileCount).toBe(2);

  await rm(TEST_ROOT, { recursive: true });
});

test("loadConfig uses defaults when no config exists", async () => {
  await mkdir(TEST_ROOT, { recursive: true });
  const config = await loadConfig(TEST_ROOT);
  expect(config.minFiles).toBe(500);
  expect(config.modelServerUrl).toBe("http://127.0.0.1:8089/v1");
  expect(config.scanDepth).toBe(6);
  await rm(TEST_ROOT, { recursive: true });
});

test("loadConfig reads custom threshold", async () => {
  await mkdir(join(TEST_ROOT, ".contextador"), { recursive: true });
  await writeFile(join(TEST_ROOT, ".contextador/config.json"), '{"minFiles": 100}');
  const config = await loadConfig(TEST_ROOT);
  expect(config.minFiles).toBe(100);
  // Defaults still applied for missing fields
  expect(config.scanDepth).toBe(6);
  await rm(TEST_ROOT, { recursive: true });
});
