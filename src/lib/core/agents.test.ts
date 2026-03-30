import { test, expect } from "bun:test";
import { buildSubagentPrompt } from "./agents";

test("buildSubagentPrompt includes scope context and query", () => {
  const prompt = buildSubagentPrompt({
    role: "professor",
    scope: "services/backend/pipelines/processing",
    contextContent: "# Processing\n## Purpose\nProcesses incoming documents.",
    query: "how does failure handling work?",
    intent: "read",
  });

  expect(prompt).toContain("services/backend/pipelines/processing");
  expect(prompt).toContain("how does failure handling work?");
  expect(prompt).toContain("Processes incoming documents");
  expect(prompt).toContain("professor");
});

test("buildSubagentPrompt for write intent includes code", () => {
  const prompt = buildSubagentPrompt({
    role: "professor",
    scope: "services/backend/pipelines/processing",
    contextContent: "# Processing",
    query: "add a webhook handler",
    intent: "write",
    code: "def handle_webhook(): pass",
  });

  expect(prompt).toContain("def handle_webhook");
  expect(prompt).toContain("write");
});
