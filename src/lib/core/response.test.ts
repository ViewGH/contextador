import { test, expect } from "bun:test";
import { mergeResults, buildContextResponse } from "./response";
import type { SubagentResult } from "./types";

test("mergeResults deduplicates files by path", () => {
  const results: SubagentResult[] = [
    {
      role: "professor",
      scope: "pipelines/eob",
      files: [{ path: "handler.py", relevantLines: [1, 10], snippet: "def handle():", why: "entry point" }],
      types: [],
      dependencies: ["db service"],
      apiSurface: [],
      tests: null,
    },
    {
      role: "professor",
      scope: "integrations",
      files: [{ path: "handler.py", relevantLines: [1, 10], snippet: "def handle():", why: "entry point" }],
      types: [],
      dependencies: ["db service"],
      apiSurface: ["POST /webhook"],
      tests: null,
    },
  ];

  const merged = mergeResults(results);
  expect(merged.files.length).toBe(1);
  expect(merged.dependencies.length).toBe(1);
  expect(merged.apiSurface.length).toBe(1);
});

test("buildContextResponse creates proper structure", () => {
  const result: SubagentResult = {
    role: "professor",
    scope: "services/backend/pipelines/eob",
    files: [{ path: "handler.py", relevantLines: [1, 10], snippet: "code", why: "reason" }],
    types: [],
    dependencies: [],
    apiSurface: [],
    tests: { location: "tests/test_eob.py", pattern: "pytest" },
  };

  const response = buildContextResponse("how does eob work?", "professor:pipelines/eob", [result], ["backend/CONTEXT.md"]);
  expect(response.query).toBe("how does eob work?");
  expect(response.routedTo).toBe("professor:pipelines/eob");
  expect(response.context.files.length).toBe(1);
  expect(response.context.tests?.location).toBe("tests/test_eob.py");
});
