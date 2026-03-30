import { test, expect } from "bun:test";
import { processFeedback, recordSuccess } from "./feedback";
import { parseFrontmatter } from "./freshness";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";

const TEST_ROOT = "/tmp/contextador-feedback-test";
const SCOPE = "services/backend";

function makeContextMd(extra = ""): string {
  return `---
last_validated: abc1234
validated_at: 2026-03-25
${extra}---

# Backend

## Purpose
Processes requests.

## Key Files
- \`src/index.ts\`
`;
}

async function setup(content?: string) {
  const dir = join(TEST_ROOT, SCOPE);
  await mkdir(dir, { recursive: true });
  await mkdir(join(TEST_ROOT, ".contextador"), { recursive: true });
  await writeFile(join(dir, "CONTEXT.md"), content ?? makeContextMd());
}

async function readContext(): Promise<string> {
  return readFile(join(TEST_ROOT, SCOPE, "CONTEXT.md"), "utf-8");
}

async function readQueue(): Promise<any[]> {
  try {
    const raw = await readFile(join(TEST_ROOT, ".contextador/repair-queue.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function cleanup() {
  await rm(TEST_ROOT, { recursive: true, force: true });
}

test("missing_context adds files to Key Files and increments feedback_failures", async () => {
  await setup();

  await processFeedback(TEST_ROOT, {
    type: "missing_context",
    scope: SCOPE,
    missingFiles: ["src/utils/auth.ts", "src/config.ts"],
  });

  const content = await readContext();

  // Check files were added
  expect(content).toContain("`src/utils/auth.ts`");
  expect(content).toContain("`src/config.ts`");

  // Check feedback_failures was added
  expect(content).toContain("feedback_failures: 1");

  // Original Key Files entry still present
  expect(content).toContain("`src/index.ts`");

  await cleanup();
});

test("build_failure increments feedback_failures and queues for janitor", async () => {
  await setup();

  await processFeedback(TEST_ROOT, {
    type: "build_failure",
    scope: SCOPE,
    detail: "tsc error in pipeline module",
  });

  const content = await readContext();
  expect(content).toContain("feedback_failures: 1");

  const queue = await readQueue();
  expect(queue.length).toBe(1);
  expect(queue[0].scope).toBe(SCOPE);
  expect(queue[0].reason).toContain("build_failure");

  await cleanup();
});

test("wrong_location increments feedback_failures and queues for janitor", async () => {
  await setup();

  await processFeedback(TEST_ROOT, {
    type: "wrong_location",
    scope: SCOPE,
    detail: "file moved to services/api",
  });

  const content = await readContext();
  expect(content).toContain("feedback_failures: 1");

  const queue = await readQueue();
  expect(queue.length).toBe(1);
  expect(queue[0].scope).toBe(SCOPE);
  expect(queue[0].reason).toContain("wrong_location");

  await cleanup();
});

test("feedback_failures counter increments on repeated feedback", async () => {
  await setup();

  await processFeedback(TEST_ROOT, {
    type: "build_failure",
    scope: SCOPE,
    detail: "first failure",
  });

  await processFeedback(TEST_ROOT, {
    type: "build_failure",
    scope: SCOPE,
    detail: "second failure",
  });

  const content = await readContext();
  expect(content).toContain("feedback_failures: 2");

  await cleanup();
});

test("recordSuccess increments feedback_successes", async () => {
  await setup();

  await recordSuccess(TEST_ROOT, SCOPE);
  await recordSuccess(TEST_ROOT, SCOPE);

  const content = await readContext();
  expect(content).toContain("feedback_successes: 2");

  await cleanup();
});
