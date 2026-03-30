import { test, expect } from "bun:test";
import { summarizeDirectory, generateContextContent } from "./generator";
import { mkdtemp, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

test("summarizeDirectory lists code files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctx-gen-"));
  await writeFile(join(dir, "index.ts"), "export default 42;");
  await writeFile(join(dir, "readme.txt"), "not code ext");
  await mkdir(join(dir, "sub"), { recursive: true });
  await writeFile(join(dir, "sub", "util.ts"), "export const x = 1;");
  await mkdir(join(dir, "node_modules"), { recursive: true });
  await writeFile(join(dir, "node_modules", "dep.js"), "module.exports = 1;");

  const files = await summarizeDirectory(dir);

  expect(files.length).toBe(2);
  expect(files.some(f => f.endsWith("index.ts"))).toBe(true);
  expect(files.some(f => f.endsWith("util.ts"))).toBe(true);
  // Should skip node_modules
  expect(files.some(f => f.includes("node_modules"))).toBe(false);
  // Should skip non-code extensions
  expect(files.some(f => f.endsWith(".txt"))).toBe(false);
});

test("summarizeDirectory respects max depth", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctx-depth-"));
  await mkdir(join(dir, "a", "b", "c", "d", "e"), { recursive: true });
  await writeFile(join(dir, "a", "one.ts"), "// depth 1");
  await writeFile(join(dir, "a", "b", "two.ts"), "// depth 2");
  await writeFile(join(dir, "a", "b", "c", "three.ts"), "// depth 3");
  await writeFile(join(dir, "a", "b", "c", "d", "four.ts"), "// depth 4");
  await writeFile(join(dir, "a", "b", "c", "d", "e", "five.ts"), "// depth 5 - too deep");

  const files = await summarizeDirectory(dir);

  expect(files.some(f => f.endsWith("one.ts"))).toBe(true);
  expect(files.some(f => f.endsWith("two.ts"))).toBe(true);
  expect(files.some(f => f.endsWith("three.ts"))).toBe(true);
  expect(files.some(f => f.endsWith("four.ts"))).toBe(true);
  // depth 5 from root is beyond max depth 4
  expect(files.some(f => f.endsWith("five.ts"))).toBe(false);
});

test("generateContextContent produces valid CONTEXT.md with frontmatter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctx-content-"));
  await writeFile(join(dir, "package.json"), '{"name": "test-pkg", "version": "1.0.0"}');
  await writeFile(join(dir, "index.ts"), "export function main() { console.log('hello'); }");
  await mkdir(join(dir, "lib"), { recursive: true });
  await writeFile(join(dir, "lib", "utils.ts"), "export const add = (a: number, b: number) => a + b;");

  const content = await generateContextContent(dir, "");

  // Should have frontmatter
  expect(content.startsWith("---\n")).toBe(true);
  expect(content).toContain("last_validated:");
  expect(content).toContain("validated_at:");

  // Should have a body after frontmatter
  const bodyStart = content.indexOf("---\n", 4);
  expect(bodyStart).toBeGreaterThan(0);
  const body = content.slice(bodyStart + 4);
  expect(body.trim().length).toBeGreaterThan(0);

  // Body should reference files in some form
  expect(body.length).toBeGreaterThan(20);
});
