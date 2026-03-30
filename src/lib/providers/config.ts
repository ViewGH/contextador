import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export type Provider = "anthropic" | "openai" | "google" | "copilot" | "openrouter" | "custom" | "claude-code";

export interface ProviderConfig {
  provider: Provider;
  apiKey: string;
  baseURL: string;
  model: string;
}

// Detection priority: explicit config > env vars > defaults
export function detectProvider(storedConfig?: Partial<ProviderConfig>): ProviderConfig {
  // 1. Stored config from ~/.contextador/config.json
  if (storedConfig?.provider && storedConfig.provider !== "claude-code") {
    return resolveProvider(storedConfig.provider, storedConfig.apiKey ?? "", storedConfig.baseURL ?? "", storedConfig.model ?? "");
  }

  // 2. Environment variables
  if (process.env.ANTHROPIC_API_KEY) {
    return resolveProvider("anthropic", process.env.ANTHROPIC_API_KEY, "", "");
  }
  if (process.env.OPENAI_API_KEY) {
    return resolveProvider("openai", process.env.OPENAI_API_KEY, "", "");
  }
  if (process.env.GOOGLE_API_KEY) {
    return resolveProvider("google", process.env.GOOGLE_API_KEY, "", "");
  }
  if (process.env.GITHUB_TOKEN) {
    return resolveProvider("copilot", process.env.GITHUB_TOKEN, "", "");
  }
  if (process.env.OPENROUTER_API_KEY) {
    return resolveProvider("openrouter", process.env.OPENROUTER_API_KEY, "", "");
  }
  if (process.env.CONTEXTADOR_API_URL) {
    return resolveProvider("custom", process.env.CONTEXTADOR_API_KEY ?? "local", process.env.CONTEXTADOR_API_URL, "");
  }

  // 3. Default: claude-code (no API needed, used via MCP)
  return { provider: "claude-code", apiKey: "", baseURL: "", model: "" };
}

function resolveProvider(provider: Provider, apiKey: string, baseURL: string, model: string): ProviderConfig {
  switch (provider) {
    case "anthropic":
      return { provider, apiKey, baseURL: "", model: model || "claude-haiku-4-5-20251001" };
    case "openai":
      return { provider, apiKey, baseURL: "", model: model || "gpt-4o-mini" };
    case "google":
      return { provider, apiKey, baseURL: "", model: model || "gemini-2.0-flash" };
    case "copilot":
      return { provider, apiKey, baseURL: "https://api.githubcopilot.com", model: model || "gpt-4o" };
    case "openrouter":
      return { provider, apiKey, baseURL: "https://openrouter.ai/api/v1", model: model || "anthropic/claude-3.5-haiku" };
    case "custom":
      return { provider, apiKey, baseURL: baseURL || "http://127.0.0.1:8089/v1", model: model || "default" };
    case "claude-code":
      return { provider, apiKey: "", baseURL: "", model: "" };
  }
}

let currentConfig: ProviderConfig | null = null;

export function configure(config: ProviderConfig): void {
  currentConfig = config;
}

export function getConfig(): ProviderConfig {
  if (!currentConfig) currentConfig = detectProvider();
  return currentConfig;
}

export function createClient() {
  const config = getConfig();
  switch (config.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: config.apiKey });
    case "openai":
      return createOpenAI({ apiKey: config.apiKey });
    case "google":
      return createGoogleGenerativeAI({ apiKey: config.apiKey });
    case "copilot":
      return createOpenAICompatible({ baseURL: config.baseURL, apiKey: config.apiKey, name: "copilot" });
    case "openrouter":
      return createOpenAICompatible({ baseURL: config.baseURL, apiKey: config.apiKey, name: "openrouter" });
    case "custom":
      return createOpenAICompatible({ baseURL: config.baseURL, apiKey: config.apiKey, name: "custom" });
    case "claude-code":
      throw new Error("Claude Code provider does not support direct API calls — use MCP tools instead");
  }
}

export function getModel(modelId?: string) {
  const config = getConfig();
  const client = createClient();
  const id = modelId ?? config.model;

  if (config.provider === "anthropic") {
    return (client as ReturnType<typeof createAnthropic>).chatModel(id);
  }
  if (config.provider === "openai") {
    return (client as ReturnType<typeof createOpenAI>).chatModel(id);
  }
  if (config.provider === "google") {
    return (client as ReturnType<typeof createGoogleGenerativeAI>).chatModel(id);
  }
  // copilot, openrouter, custom — all OpenAI-compatible
  return (client as ReturnType<typeof createOpenAICompatible>).chatModel(id);
}

/** Test if the configured provider is reachable */
export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  const config = getConfig();
  if (config.provider === "claude-code") {
    return { ok: true }; // Always "reachable" — it's the host
  }
  try {
    if (config.provider === "custom") {
      const res = await fetch(`${config.baseURL}/models`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
    }
    // For cloud providers, try a minimal API call
    const model = getModel();
    const { generateText } = await import("ai");
    await generateText({ model, prompt: "hi", maxTokens: 1 });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
