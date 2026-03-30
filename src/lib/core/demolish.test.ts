import { test, expect } from "bun:test";
import { isContextadorGenerated, demolish } from "./demolish";
import { mkdir, writeFile, readFile, rm, access } from "fs/promises";
import { join } from "path";

const TEST_ROOT = "/tmp/contextador-demolish-test";

test("isContextadorGenerated returns true for contextador files", () => {
  expect(isContextadorGenerated("---\nlast_validated: abc\nvalidated_at: 2026-03-27\n---\n# Test\n")).toBe(true);
});

test("isContextadorGenerated returns false for human files", () => {
  expect(isContextadorGenerated("# Test\n\n## Purpose\nHuman written.\n")).toBe(false);
});

test("demolish removes .contextador/ and generated CONTEXT.md", async () => {
  // Setup
  await mkdir(join(TEST_ROOT, ".contextador"), { recursive: true });
  await mkdir(join(TEST_ROOT, "services/backend"), { recursive: true });
  await mkdir(join(TEST_ROOT, "docs"), { recursive: true });
  await writeFile(join(TEST_ROOT, ".contextador/briefing.md"), "briefing");
  await writeFile(join(TEST_ROOT, "services/backend/CONTEXT.md"), "---\nlast_validated: abc\nvalidated_at: 2026-03-27\n---\n# Backend\n");
  await writeFile(join(TEST_ROOT, "docs/CONTEXT.md"), "# Docs\n\nHuman written context.\n");
  await writeFile(join(TEST_ROOT, ".mcp.json"), '{"mcpServers":{"contextador":{"command":"contextador-mcp"}}}');

  const result = await demolish(TEST_ROOT);

  expect(result.contextadorDirRemoved).toBe(true);
  expect(result.contextFilesRemoved).toContain("services/backend/CONTEXT.md");
  expect(result.contextFilesKept).toContain("docs/CONTEXT.md");
  expect(result.mcpJsonUpdated).toBe(true);

  // Verify .contextador is gone
  let exists = true;
  try { await access(join(TEST_ROOT, ".contextador")); } catch { exists = false; }
  expect(exists).toBe(false);

  // Verify generated CONTEXT.md is gone
  let backendExists = true;
  try { await access(join(TEST_ROOT, "services/backend/CONTEXT.md")); } catch { backendExists = false; }
  expect(backendExists).toBe(false);

  // Verify human CONTEXT.md is kept
  const docsContent = await readFile(join(TEST_ROOT, "docs/CONTEXT.md"), "utf-8");
  expect(docsContent).toContain("Human written");

  // Verify .mcp.json is removed (was only entry)
  let mcpExists = true;
  try { await access(join(TEST_ROOT, ".mcp.json")); } catch { mcpExists = false; }
  expect(mcpExists).toBe(false);

  await rm(TEST_ROOT, { recursive: true });
});

test("demolish keeps .mcp.json if other servers exist", async () => {
  await mkdir(TEST_ROOT, { recursive: true });
  await writeFile(join(TEST_ROOT, ".mcp.json"), '{"mcpServers":{"contextador":{"command":"contextador-mcp"},"other":{"command":"other-server"}}}');

  const result = await demolish(TEST_ROOT);
  expect(result.mcpJsonUpdated).toBe(true);

  const mcp = JSON.parse(await readFile(join(TEST_ROOT, ".mcp.json"), "utf-8"));
  expect(mcp.mcpServers.other).toBeDefined();
  expect(mcp.mcpServers.contextador).toBeUndefined();

  await rm(TEST_ROOT, { recursive: true });
});
