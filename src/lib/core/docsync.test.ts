import { test, expect } from "bun:test";
import { generateServiceIndex, generateDepsSection, syncArchitectureDeps } from "./docsync";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";

const TEST_ROOT = "/tmp/contextador-docsync-test";

async function setupTestRoot() {
  await rm(TEST_ROOT, { recursive: true }).catch(() => {});
  await mkdir(join(TEST_ROOT, "services/backend"), { recursive: true });
  await mkdir(join(TEST_ROOT, "frontends/web-app"), { recursive: true });
  await writeFile(
    join(TEST_ROOT, "services/backend/CONTEXT.md"),
    "---\nlast_validated: abc\nvalidated_at: 2026-03-25\n---\n# Backend\n\n## Purpose\nProcesses EOB documents.\n\n## Dependencies\n- **Upstream:** web-app (sends API requests)\n- **Downstream:** MongoDB, Redis\n"
  );
  await writeFile(
    join(TEST_ROOT, "frontends/web-app/CONTEXT.md"),
    "---\nlast_validated: def\nvalidated_at: 2026-03-25\n---\n# Web App\n\n## Purpose\nReact SPA for claims.\n\n## Dependencies\n- **Upstream:** Office staff\n- **Downstream:** Backend API\n"
  );
}

test("generateServiceIndex creates table from CONTEXT.md files", async () => {
  await setupTestRoot();

  const index = await generateServiceIndex(TEST_ROOT);
  expect(index).toContain("Backend");
  expect(index).toContain("Web App");
  expect(index).toContain("services/backend");

  await rm(TEST_ROOT, { recursive: true });
});

test("generateDepsSection extracts upstream/downstream from CONTEXT.md files", async () => {
  await setupTestRoot();

  const section = await generateDepsSection(TEST_ROOT);
  expect(section).toContain("<!-- CONTEXTADOR:DEPS:START -->");
  expect(section).toContain("<!-- CONTEXTADOR:DEPS:END -->");
  expect(section).toContain("Backend");
  expect(section).toContain("MongoDB, Redis");
  expect(section).toContain("web-app (sends API requests)");
  expect(section).toContain("Web App");
  expect(section).toContain("Backend API");

  await rm(TEST_ROOT, { recursive: true });
});

test("generateDepsSection skips CONTEXT.md without dependencies", async () => {
  await rm(TEST_ROOT, { recursive: true }).catch(() => {});
  await mkdir(join(TEST_ROOT, "services/nodeps"), { recursive: true });
  await writeFile(
    join(TEST_ROOT, "services/nodeps/CONTEXT.md"),
    "---\nlast_validated: abc\nvalidated_at: 2026-03-25\n---\n# NoDeps\n\n## Purpose\nA service with no deps section.\n"
  );

  const section = await generateDepsSection(TEST_ROOT);
  expect(section).not.toContain("NoDeps");

  await rm(TEST_ROOT, { recursive: true });
});

test("syncArchitectureDeps replaces content between markers", async () => {
  await setupTestRoot();
  await mkdir(join(TEST_ROOT, "docs"), { recursive: true });
  await writeFile(
    join(TEST_ROOT, "docs/architecture.md"),
    "# Architecture\n\n## Overview\nManual content.\n\n<!-- CONTEXTADOR:DEPS:START -->\nold deps content\n<!-- CONTEXTADOR:DEPS:END -->\n\n## Data Flow\nMore manual content.\n"
  );

  await syncArchitectureDeps(TEST_ROOT);

  const result = await readFile(join(TEST_ROOT, "docs/architecture.md"), "utf-8");
  expect(result).toContain("## Overview\nManual content.");
  expect(result).toContain("## Data Flow\nMore manual content.");
  expect(result).not.toContain("old deps content");
  expect(result).toContain("Backend");
  expect(result).toContain("<!-- CONTEXTADOR:DEPS:START -->");
  expect(result).toContain("<!-- CONTEXTADOR:DEPS:END -->");

  await rm(TEST_ROOT, { recursive: true });
});

test("syncArchitectureDeps appends markers when absent", async () => {
  await setupTestRoot();
  await mkdir(join(TEST_ROOT, "docs"), { recursive: true });
  await writeFile(
    join(TEST_ROOT, "docs/architecture.md"),
    "# Architecture\n\nManual content only.\n"
  );

  await syncArchitectureDeps(TEST_ROOT);

  const result = await readFile(join(TEST_ROOT, "docs/architecture.md"), "utf-8");
  expect(result).toContain("Manual content only.");
  expect(result).toContain("<!-- CONTEXTADOR:DEPS:START -->");
  expect(result).toContain("<!-- CONTEXTADOR:DEPS:END -->");
  expect(result).toContain("Backend");

  await rm(TEST_ROOT, { recursive: true });
});
