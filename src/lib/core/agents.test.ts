import { test, expect } from "bun:test";
import { buildSubagentPrompt } from "./agents";

test("buildSubagentPrompt includes scope context and query", () => {
  const prompt = buildSubagentPrompt({
    role: "professor",
    scope: "services/backend/pipelines/eob",
    contextContent: "# EOB\n## Purpose\nProcesses EOB documents.",
    query: "how does failure handling work?",
    intent: "read",
  });

  expect(prompt).toContain("services/backend/pipelines/eob");
  expect(prompt).toContain("how does failure handling work?");
  expect(prompt).toContain("Processes EOB documents");
  expect(prompt).toContain("professor");
});

test("buildSubagentPrompt for write intent includes code", () => {
  const prompt = buildSubagentPrompt({
    role: "professor",
    scope: "services/backend/pipelines/eob",
    contextContent: "# EOB",
    query: "add a webhook handler",
    intent: "write",
    code: "def handle_webhook(): pass",
  });

  expect(prompt).toContain("def handle_webhook");
  expect(prompt).toContain("write");
});
