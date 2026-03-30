import { test, expect } from "bun:test";
import { validateContext } from "./validation";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const TEST_ROOT = "/tmp/contextador-validation-test";

test("validateContext returns missing when no CONTEXT.md", async () => {
  await mkdir(join(TEST_ROOT, "empty"), { recursive: true });
  const result = await validateContext(TEST_ROOT, join(TEST_ROOT, "empty/CONTEXT.md"));
  expect(result.status).toBe("missing");
  await rm(TEST_ROOT, { recursive: true });
});

test("validateContext returns pass when files exist", async () => {
  await mkdir(join(TEST_ROOT, "good"), { recursive: true });
  await writeFile(join(TEST_ROOT, "good/main.py"), "print('hi')");
  await writeFile(join(TEST_ROOT, "good/CONTEXT.md"), "---\nlast_validated: abc\nvalidated_at: 2026-03-25\n---\n# Good\n\n## Key Files\n- main.py — entry\n");
  const result = await validateContext(TEST_ROOT, join(TEST_ROOT, "good/CONTEXT.md"));
  expect(result.status).toBe("pass");
  await rm(TEST_ROOT, { recursive: true });
});

test("validateContext returns major when most key files missing", async () => {
  await mkdir(join(TEST_ROOT, "bad"), { recursive: true });
  await writeFile(join(TEST_ROOT, "bad/CONTEXT.md"), "---\nlast_validated: abc\nvalidated_at: 2026-03-25\n---\n# Bad\n\n## Key Files\n- gone1.py — nope\n- gone2.py — nope\n- gone3.py — nope\n");
  const result = await validateContext(TEST_ROOT, join(TEST_ROOT, "bad/CONTEXT.md"));
  expect(result.status).toBe("major");
  await rm(TEST_ROOT, { recursive: true });
});
