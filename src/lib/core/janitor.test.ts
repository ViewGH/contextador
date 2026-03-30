import { test, expect } from "bun:test";
import { processRepairQueue, detectNewScopes } from "./janitor";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const TEST_ROOT = "/tmp/contextador-janitor-test";

test("processRepairQueue handles empty queue", async () => {
  await mkdir(join(TEST_ROOT, ".contextador"), { recursive: true });
  await writeFile(join(TEST_ROOT, ".contextador/repair-queue.json"), "[]");
  const result = await processRepairQueue(TEST_ROOT);
  expect(result.processed).toBe(0);
  await rm(TEST_ROOT, { recursive: true });
});

test("detectNewScopes finds directories without CONTEXT.md", async () => {
  await mkdir(join(TEST_ROOT, "services/new-service"), { recursive: true });
  await writeFile(join(TEST_ROOT, "services/new-service/main.ts"), "export {}");
  const scopes = await detectNewScopes(TEST_ROOT);
  expect(scopes.some(s => s.includes("new-service"))).toBe(true);
  await rm(TEST_ROOT, { recursive: true });
});
