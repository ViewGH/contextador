import { describe, expect, test } from "bun:test";
import {
  extractChangedFiles,
  filterTrivialFiles,
  mapFilesToScopes,
} from "./triage";
import type { GitHubPushPayload } from "./types";

const makePush = (commits: Array<{ added?: string[]; modified?: string[]; removed?: string[] }>): GitHubPushPayload => ({
  ref: "refs/heads/main",
  before: "aaa",
  after: "bbb",
  repository: { full_name: "test/repo", name: "repo", default_branch: "main" },
  commits: commits.map((c, i) => ({
    id: `commit-${i}`,
    message: `commit ${i}`,
    timestamp: new Date().toISOString(),
    added: c.added ?? [],
    modified: c.modified ?? [],
    removed: c.removed ?? [],
  })),
  head_commit: null,
  pusher: { name: "test", email: "test@test.com" },
  forced: false,
});

describe("extractChangedFiles", () => {
  test("collects files from multiple commits", () => {
    const payload = makePush([
      { added: ["src/a.ts"], modified: ["src/b.ts"] },
      { modified: ["src/c.ts"], removed: ["src/d.ts"] },
    ]);

    const result = extractChangedFiles(payload);
    expect(result.added).toEqual(["src/a.ts"]);
    expect(result.modified).toContain("src/b.ts");
    expect(result.modified).toContain("src/c.ts");
    expect(result.removed).toEqual(["src/d.ts"]);
    expect(result.all.length).toBe(4);
  });

  test("deduplicates across commits", () => {
    const payload = makePush([
      { modified: ["src/a.ts"] },
      { modified: ["src/a.ts"] },
    ]);

    const result = extractChangedFiles(payload);
    expect(result.modified).toEqual(["src/a.ts"]);
    expect(result.all.length).toBe(1);
  });
});

describe("filterTrivialFiles", () => {
  test("removes lockfiles", () => {
    const result = filterTrivialFiles(["src/a.ts", "package-lock.json", "bun.lock"]);
    expect(result).toEqual(["src/a.ts"]);
  });

  test("removes CI configs", () => {
    const result = filterTrivialFiles(["src/a.ts", ".github/workflows/ci.yml"]);
    expect(result).toEqual(["src/a.ts"]);
  });

  test("removes image assets", () => {
    const result = filterTrivialFiles(["src/a.ts", "assets/logo.png", "public/icon.svg"]);
    expect(result).toEqual(["src/a.ts"]);
  });

  test("removes CONTEXT.md and .contextador files", () => {
    const result = filterTrivialFiles(["src/a.ts", "src/CONTEXT.md", ".contextador/config.json"]);
    expect(result).toEqual(["src/a.ts"]);
  });

  test("keeps real code files", () => {
    const files = ["src/lib/core/janitor.ts", "src/cli.ts", "README.md"];
    // README.md is not trivial — it describes the project
    const result = filterTrivialFiles(files);
    expect(result).toEqual(files);
  });
});

describe("mapFilesToScopes", () => {
  test("maps files to their deepest known scope", () => {
    const files = ["src/lib/core/janitor.ts", "src/lib/core/freshness.ts", "src/cli.ts"];
    const scopes = ["src", "src/lib", "src/lib/core"];

    const result = mapFilesToScopes(files, scopes);
    expect(result.get("src/lib/core")).toEqual(["src/lib/core/janitor.ts", "src/lib/core/freshness.ts"]);
    expect(result.get("src")).toEqual(["src/cli.ts"]);
  });

  test("falls back to top-level dir for unknown scopes", () => {
    const files = ["tools/helper.ts"];
    const scopes = ["src", "src/lib"];

    const result = mapFilesToScopes(files, scopes);
    expect(result.get("tools")).toEqual(["tools/helper.ts"]);
  });

  test("handles root-level files", () => {
    const files = ["package.json"];
    const scopes = ["src"];

    const result = mapFilesToScopes(files, scopes);
    expect(result.get(".")).toEqual(["package.json"]);
  });
});
