import { test, expect } from "bun:test";
import { routeQuery } from "./headmaster";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const TEST_ROOT = "/tmp/contextador-test-headmaster";

test("routeQuery short-circuits to professor for specific scope", async () => {
  await mkdir(join(TEST_ROOT, "services/backend/pipelines/eob"), { recursive: true });
  await writeFile(join(TEST_ROOT, "CONTEXT.md"), "# Project\n## Overview\nMonorepo.");
  await writeFile(join(TEST_ROOT, "services/CONTEXT.md"), "# Services");
  await writeFile(join(TEST_ROOT, "services/backend/CONTEXT.md"), "# Backend\n## Internal Structure\n- pipelines/ — Processing pipelines including eob, era");
  await writeFile(join(TEST_ROOT, "services/backend/pipelines/CONTEXT.md"), "# Pipelines\n- eob/ — EOB processing");
  await writeFile(join(TEST_ROOT, "services/backend/pipelines/eob/CONTEXT.md"), "# EOB Pipeline\n## Purpose\nProcesses EOB documents through 5 stages.");

  const route = await routeQuery(TEST_ROOT, "how does EOB processing work?");

  expect(route.targetScope).toContain("eob");
  expect(route.contextChain.length).toBeGreaterThan(0);

  await rm(TEST_ROOT, { recursive: true });
});

test("routeQuery fans out for ambiguous cross-cutting query", async () => {
  await mkdir(join(TEST_ROOT, "services/backend"), { recursive: true });
  await mkdir(join(TEST_ROOT, "services/admin-backend"), { recursive: true });
  await writeFile(join(TEST_ROOT, "CONTEXT.md"), "# Project");
  await writeFile(join(TEST_ROOT, "services/CONTEXT.md"), "# Services");
  await writeFile(join(TEST_ROOT, "services/backend/CONTEXT.md"), "# Backend\n## Data\nMongoDB jobs collection");
  await writeFile(join(TEST_ROOT, "services/admin-backend/CONTEXT.md"), "# Admin Backend\n## Data\nMongoDB jobs collection");

  const route = await routeQuery(TEST_ROOT, "what services write to the jobs collection?");

  expect(route.fanOut).toBe(true);
  expect(route.targets.length).toBeGreaterThan(1);

  await rm(TEST_ROOT, { recursive: true });
});
