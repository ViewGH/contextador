import type { ContextResponse, SubagentResult, FileContext, TypeContext, TestContext, StalenessWarning } from "./types";

export function mergeResults(results: SubagentResult[]): {
  files: FileContext[];
  types: TypeContext[];
  dependencies: string[];
  apiSurface: string[];
  tests: TestContext | null;
} {
  const seenFiles = new Set<string>();
  const files: FileContext[] = [];
  const seenTypes = new Set<string>();
  const types: TypeContext[] = [];
  const depSet = new Set<string>();
  const apiSet = new Set<string>();
  let tests: TestContext | null = null;

  for (const r of results) {
    for (const f of r.files) {
      if (!seenFiles.has(f.path)) {
        seenFiles.add(f.path);
        files.push(f);
      }
    }
    for (const t of r.types) {
      if (!seenTypes.has(t.path)) {
        seenTypes.add(t.path);
        types.push(t);
      }
    }
    for (const d of r.dependencies) depSet.add(d);
    for (const a of r.apiSurface) apiSet.add(a);
    if (r.tests && !tests) tests = r.tests;
  }

  return {
    files,
    types,
    dependencies: Array.from(depSet),
    apiSurface: Array.from(apiSet),
    tests,
  };
}

export function buildContextResponse(
  query: string,
  routedTo: string,
  results: SubagentResult[],
  contextChain: string[],
  staleWarnings: StalenessWarning[] = [],
): ContextResponse {
  const merged = mergeResults(results);
  return {
    query,
    routedTo,
    staleWarnings,
    context: {
      ...merged,
      contextChain,
    },
  };
}

export function serializeResponse(response: ContextResponse): string {
  const { context } = response;
  const parts: string[] = [];

  parts.push(`## Context for: ${response.query}`);
  parts.push(`Routed to: ${response.routedTo}\n`);

  if (context.files.length) {
    parts.push("### Relevant Files");
    for (const f of context.files) {
      parts.push(`**${f.path}**${f.relevantLines ? ` (lines ${f.relevantLines[0]}-${f.relevantLines[1]})` : ""}`);
      parts.push(`Why: ${f.why}`);
      parts.push("```\n" + f.snippet + "\n```\n");
    }
  }

  if (context.types.length) {
    parts.push("### Type Definitions");
    for (const t of context.types) {
      parts.push(`**${t.path}**`);
      parts.push("```\n" + t.snippet + "\n```\n");
    }
  }

  if (context.dependencies.length) {
    parts.push("### Dependencies");
    for (const d of context.dependencies) parts.push(`- ${d}`);
    parts.push("");
  }

  if (context.apiSurface.length) {
    parts.push("### API Surface");
    for (const a of context.apiSurface) parts.push(`- ${a}`);
    parts.push("");
  }

  if (context.tests) {
    parts.push("### Tests");
    parts.push(`Location: ${context.tests.location}`);
    parts.push(`Pattern: ${context.tests.pattern}\n`);
  }

  if (response.staleWarnings.length > 0) {
    parts.push("### Staleness Warnings");
    for (const w of response.staleWarnings) {
      const icon = w.severity === "major" ? "🔴" : "🟡";
      parts.push(`${icon} **${w.scope}**: ${w.detail}`);
    }
    parts.push("");
  }

  parts.push(`### Context Chain: ${context.contextChain.join(" → ")}`);

  return parts.join("\n");
}
