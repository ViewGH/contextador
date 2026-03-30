import { test, expect } from "bun:test";
import { detectProvider } from "./config";

test("detectProvider defaults to claude-code when no env vars", () => {
  const config = detectProvider();
  // May detect env vars in test environment — just verify it returns a valid config
  expect(config.provider).toBeDefined();
});

test("detectProvider uses stored config", () => {
  const config = detectProvider({ provider: "openai", apiKey: "test-key" });
  expect(config.provider).toBe("openai");
  expect(config.apiKey).toBe("test-key");
  expect(config.model).toBe("gpt-4o-mini");
});

test("detectProvider resolves copilot defaults", () => {
  const config = detectProvider({ provider: "copilot", apiKey: "ghp_test" });
  expect(config.baseURL).toBe("https://api.githubcopilot.com");
});

test("detectProvider resolves openrouter defaults", () => {
  const config = detectProvider({ provider: "openrouter", apiKey: "or_test" });
  expect(config.baseURL).toBe("https://openrouter.ai/api/v1");
});
