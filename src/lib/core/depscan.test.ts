import { test, expect } from "bun:test";
import { detectImports, matchImportsToScopes, scanAllDependencies } from "./depscan";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const TEST_ROOT = "/tmp/contextador-test-depscan";

async function setup() {
  await rm(TEST_ROOT, { recursive: true }).catch(() => {});
  await mkdir(TEST_ROOT, { recursive: true });
}

test("detectImports finds Python imports (from/import)", async () => {
  await setup();
  await writeFile(
    join(TEST_ROOT, "main.py"),
    [
      "from services.backend.pipelines import processing_handler",
      "import tools.contextador.lib",
      "import os",
    ].join("\n"),
  );

  const imports = await detectImports(TEST_ROOT);
  expect(imports).toContain("services.backend.pipelines");
  expect(imports).toContain("tools.contextador.lib");
  // single-segment stdlib should be skipped
  expect(imports).not.toContain("os");

  await rm(TEST_ROOT, { recursive: true });
});

test("detectImports finds TypeScript imports (import from/require)", async () => {
  await setup();
  await writeFile(
    join(TEST_ROOT, "index.ts"),
    [
      'import { foo } from "services/backend/api";',
      'const bar = require("tools/contextador/lib");',
      'import x from "./local";',
    ].join("\n"),
  );

  const imports = await detectImports(TEST_ROOT);
  expect(imports).toContain("services/backend/api");
  expect(imports).toContain("tools/contextador/lib");
  // relative import should be skipped
  expect(imports).not.toContain("./local");

  await rm(TEST_ROOT, { recursive: true });
});

test("detectImports skips relative imports", async () => {
  await setup();
  await writeFile(
    join(TEST_ROOT, "mod.py"),
    ["from .sibling import helper", "from ..parent import util"].join("\n"),
  );
  await writeFile(
    join(TEST_ROOT, "mod.ts"),
    ['import a from "../up";', 'import b from "./here";'].join("\n"),
  );

  const imports = await detectImports(TEST_ROOT);
  expect(imports.length).toBe(0);

  await rm(TEST_ROOT, { recursive: true });
});

test("matchImportsToScopes maps to known scopes correctly", () => {
  const knownScopes = [
    "services/backend",
    "services/backend/pipelines",
    "services/backend/pipelines/processing",
    "tools/contextador",
  ];

  const imports = [
    "services.backend.pipelines.processing.handler",   // Python-style → services/backend/pipelines/processing
    "tools/contextador/lib",                      // TS-style → tools/contextador
    "services/backend/api",                       // → services/backend
    "unknown/package/foo",                        // no match
  ];

  const matched = matchImportsToScopes(imports, knownScopes);
  expect(matched).toContain("services/backend/pipelines/processing");
  expect(matched).toContain("tools/contextador");
  expect(matched).toContain("services/backend");
  expect(matched).not.toContain("unknown/package/foo");
  expect(matched.length).toBe(3);
});

const SCAN_ALL_ROOT = "/tmp/contextador-test-scanall";

test("scanAllDependencies builds consumes and implementsFor correctly", async () => {
  await rm(SCAN_ALL_ROOT, { recursive: true }).catch(() => {});

  // Create scope A: imports from scope B
  await mkdir(join(SCAN_ALL_ROOT, "scopeA"), { recursive: true });
  await writeFile(join(SCAN_ALL_ROOT, "scopeA/CONTEXT.md"), "# Scope A\n");
  await writeFile(
    join(SCAN_ALL_ROOT, "scopeA/index.ts"),
    'import { thing } from "scopeB/utils";\n',
  );

  // Create scope B: imports from scope C
  await mkdir(join(SCAN_ALL_ROOT, "scopeB"), { recursive: true });
  await writeFile(join(SCAN_ALL_ROOT, "scopeB/CONTEXT.md"), "# Scope B\n");
  await writeFile(
    join(SCAN_ALL_ROOT, "scopeB/index.ts"),
    'import { other } from "scopeC/lib";\n',
  );

  // Create scope C: no imports
  await mkdir(join(SCAN_ALL_ROOT, "scopeC"), { recursive: true });
  await writeFile(join(SCAN_ALL_ROOT, "scopeC/CONTEXT.md"), "# Scope C\n");
  await writeFile(join(SCAN_ALL_ROOT, "scopeC/index.ts"), "export const x = 1;\n");

  // Root CONTEXT.md
  await writeFile(join(SCAN_ALL_ROOT, "CONTEXT.md"), "# Root\n");

  const result = await scanAllDependencies(SCAN_ALL_ROOT);

  // A consumes B
  const a = result.get("scopeA")!;
  expect(a.consumes).toContain("scopeB");
  expect(a.implementsFor).toEqual([]);

  // B consumes C, implements for A
  const b = result.get("scopeB")!;
  expect(b.consumes).toContain("scopeC");
  expect(b.implementsFor).toContain("scopeA");

  // C consumes nothing, implements for B
  const c = result.get("scopeC")!;
  expect(c.consumes).toEqual([]);
  expect(c.implementsFor).toContain("scopeB");

  await rm(SCAN_ALL_ROOT, { recursive: true });
});

test("scanAllDependencies excludes self-references", async () => {
  await rm(SCAN_ALL_ROOT, { recursive: true }).catch(() => {});

  // Scope that imports from itself (should not appear in consumes)
  await mkdir(join(SCAN_ALL_ROOT, "solo"), { recursive: true });
  await writeFile(join(SCAN_ALL_ROOT, "solo/CONTEXT.md"), "# Solo\n");
  await writeFile(
    join(SCAN_ALL_ROOT, "solo/index.ts"),
    'import { x } from "solo/other";\n',
  );
  await writeFile(join(SCAN_ALL_ROOT, "CONTEXT.md"), "# Root\n");

  const result = await scanAllDependencies(SCAN_ALL_ROOT);
  const solo = result.get("solo")!;
  expect(solo.consumes).not.toContain("solo");
  expect(solo.implementsFor).not.toContain("solo");

  await rm(SCAN_ALL_ROOT, { recursive: true });
});
