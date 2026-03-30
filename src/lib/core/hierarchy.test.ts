import { test, expect } from "bun:test";
import { buildHierarchy, findContextFiles, computeRoleMap } from "./hierarchy";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const TEST_ROOT = "/tmp/contextador-test-hierarchy";

test("findContextFiles discovers nested CONTEXT.md files", async () => {
  await mkdir(join(TEST_ROOT, "services/backend/pipelines/processing"), { recursive: true });
  await writeFile(join(TEST_ROOT, "services/backend/CONTEXT.md"), "# Backend");
  await writeFile(join(TEST_ROOT, "services/backend/pipelines/CONTEXT.md"), "# Pipelines");
  await writeFile(join(TEST_ROOT, "services/backend/pipelines/processing/CONTEXT.md"), "# Processing");

  const files = await findContextFiles(TEST_ROOT);
  expect(files.length).toBe(3);
  expect(files.some(f => f.includes("pipelines/processing/CONTEXT.md"))).toBe(true);

  await rm(TEST_ROOT, { recursive: true });
});

test("buildHierarchy creates correct node tree", async () => {
  await mkdir(join(TEST_ROOT, "services/backend/pipelines/processing"), { recursive: true });
  await writeFile(join(TEST_ROOT, "CONTEXT.md"), "# Root");
  await writeFile(join(TEST_ROOT, "services/CONTEXT.md"), "# Services");
  await writeFile(join(TEST_ROOT, "services/backend/CONTEXT.md"), "# Backend");
  await writeFile(join(TEST_ROOT, "services/backend/pipelines/CONTEXT.md"), "# Pipelines");
  await writeFile(join(TEST_ROOT, "services/backend/pipelines/processing/CONTEXT.md"), "# Processing");

  const tree = await buildHierarchy(TEST_ROOT);

  expect(tree.role).toBe("headmaster");
  expect(tree.scope).toBe("");
  expect(tree.children.length).toBeGreaterThan(0);

  await rm(TEST_ROOT, { recursive: true });
});

test("computeRoleMap: shallow repo (depth 2) skips dean and chair", () => {
  const map = computeRoleMap(2);
  expect(map[0]).toBe("headmaster");
  expect(map[1]).toBe("professor");
  expect(map[2]).toBe("pupil");
});

test("computeRoleMap: standard repo (depth 4) uses full hierarchy", () => {
  const map = computeRoleMap(4);
  expect(map[0]).toBe("headmaster");
  expect(map[1]).toBe("dean");
  expect(map[2]).toBe("chair");
  expect(map[3]).toBe("professor");
  expect(map[4]).toBe("pupil");
});

test("computeRoleMap: deep repo (depth 6) adds extra roles", () => {
  const map = computeRoleMap(6);
  expect(map[0]).toBe("headmaster");
  expect(map[5]).toBe("head-pupil");
  expect(map[6]).toBe("pupil");
});
