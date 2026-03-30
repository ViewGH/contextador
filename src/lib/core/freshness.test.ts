import { test, expect } from "bun:test";
import { parseFrontmatter, buildFrontmatter, daysSince } from "./freshness";

test("parseFrontmatter extracts SHA and date", () => {
  const content = `---
last_validated: a1b2c3d
validated_at: 2026-03-25
---
# Backend

## Purpose
Processes things.`;

  const { frontmatter, body } = parseFrontmatter(content);
  expect(frontmatter.lastValidated).toBe("a1b2c3d");
  expect(frontmatter.validatedAt).toBe("2026-03-25");
  expect(body).toContain("# Backend");
  expect(body).not.toContain("last_validated");
});

test("parseFrontmatter handles missing frontmatter", () => {
  const content = "# Backend\n## Purpose\nDoes stuff.";
  const { frontmatter, body } = parseFrontmatter(content);
  expect(frontmatter.lastValidated).toBeNull();
  expect(frontmatter.validatedAt).toBeNull();
  expect(body).toBe(content);
});

test("buildFrontmatter creates valid YAML frontmatter", () => {
  const fm = buildFrontmatter("a1b2c3d", "2026-03-25");
  expect(fm).toBe("---\nlast_validated: a1b2c3d\nvalidated_at: 2026-03-25\n---\n");
});

test("daysSince calculates correctly", () => {
  const today = new Date().toISOString().split("T")[0];
  expect(daysSince(today)).toBe(0);

  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  expect(daysSince(yesterday)).toBe(1);
});
