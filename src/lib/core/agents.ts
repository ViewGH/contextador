import { generateText, type CoreTool } from "ai";
import { readFile } from "fs/promises";
import { getModel } from "../providers/config";
import { readContextFile } from "./hierarchy";
import { parseHitLog, hasHit, hashKeywords } from "./hitlog";
import type { Role, SubagentResult } from "./types";

interface SubagentPromptInput {
  role: Role;
  scope: string;
  contextContent: string;
  query: string;
  intent: "read" | "write";
  code?: string;
  hitHints?: string[];
}

export function buildSubagentPrompt(input: SubagentPromptInput): string {
  const { role, scope, contextContent, query, intent, code } = input;

  return `You are Contextador role:${role}, responsible for the scope: ${scope || "root (entire monorepo)"}.

Here is your CONTEXT.md:
---
${contextContent}
---

A build agent has a ${intent} request: "${query}"
${code ? `\nCode provided:\n\`\`\`\n${code}\n\`\`\`` : ""}

Your job:
- For READ: identify the specific files, types, dependencies, API surfaces, and test locations relevant to this query within your scope. Return ONLY what is needed — minimize tokens.
- For WRITE: determine exactly where the provided code should be placed within your scope, and what CONTEXT.md updates are needed.

Respond with a JSON object matching this schema:
{
  "files": [{ "path": "relative/path", "relevantLines": [start, end], "snippet": "key code", "why": "reason" }],
  "types": [{ "path": "relative/path", "snippet": "type definition" }],
  "dependencies": ["description of dependency"],
  "apiSurface": ["endpoint or interface"],
  "tests": { "location": "test/path", "pattern": "framework info" } | null
}

Be precise. Only include what directly answers the query.${input.hitHints && input.hitHints.length > 0 ? "\nNote: Similar queries have successfully found relevant context in this scope before. This scope is likely relevant — prioritize looking here." : ""}`;
}

export async function spawnSubagent(
  role: Role,
  scope: string,
  contextPath: string,
  query: string,
  intent: "read" | "write",
  tools: Record<string, CoreTool>,
  code?: string,
): Promise<SubagentResult> {
  const contextContent = await readContextFile(contextPath);

  let hitHints: string[] = [];
  try {
    const rawContent = await readFile(contextPath, "utf-8");
    const hitLog = parseHitLog(rawContent);
    const queryKeywords = query.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length >= 3);
    const queryHash = hashKeywords(queryKeywords);
    if (hasHit(hitLog, queryHash)) {
      hitHints = [queryHash];
    }
  } catch {}

  const prompt = buildSubagentPrompt({ role, scope, contextContent, query, intent, code, hitHints });

  const model = getModel("local-coding");

  const result = await generateText({
    model,
    system: prompt,
    messages: [{ role: "user", content: `Answer the ${intent} request. Use tools if you need to read files within your scope to give precise answers. Respond with JSON.` }],
    tools,
    maxSteps: 5,
    temperature: 0.1,
  });

  try {
    const parsed = JSON.parse(result.text);
    return {
      role,
      scope,
      files: parsed.files ?? [],
      types: parsed.types ?? [],
      dependencies: parsed.dependencies ?? [],
      apiSurface: parsed.apiSurface ?? [],
      tests: parsed.tests ?? null,
    };
  } catch {
    return {
      role,
      scope,
      files: [],
      types: [],
      dependencies: [],
      apiSurface: [],
      tests: null,
    };
  }
}

export async function spawnParallel(
  agents: Array<{
    role: Role;
    scope: string;
    contextPath: string;
  }>,
  query: string,
  intent: "read" | "write",
  tools: Record<string, CoreTool>,
  code?: string,
): Promise<SubagentResult[]> {
  return Promise.all(
    agents.map(a => spawnSubagent(a.role, a.scope, a.contextPath, query, intent, tools, code))
  );
}
