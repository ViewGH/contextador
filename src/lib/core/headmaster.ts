import { generateText } from "ai";
import { readFile } from "fs/promises";
import { getModel } from "../providers/config";
import { buildHierarchy, findContextFiles, readContextFile } from "./hierarchy";
import type { HierarchyNode } from "./types";
import { dirname, relative, join, sep } from "path";

export interface RouteResult {
  targetScope: string;
  targetRole: string;
  contextChain: string[];
  fanOut: boolean;
  targets: Array<{ scope: string; contextPath: string }>;
}

async function loadBriefing(root: string): Promise<string | null> {
  try {
    const content = await readFile(join(root, ".contextador", "briefing.md"), "utf-8");
    if (content.trim().length > 0) return content;
  } catch {}
  return null;
}

async function buildRoutingSummary(root: string): Promise<string> {
  const files = await findContextFiles(root);
  const summaries: string[] = [];

  for (const file of files) {
    const rel = relative(root, file);
    const content = await readContextFile(file);
    const preview = content.split("\n").slice(0, 5).join("\n");
    summaries.push(`### ${rel}\n${preview}\n`);
  }

  return summaries.join("\n");
}

/** Extract keywords from a query (lowercase, no stop words, 3+ chars) */
function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "each",
    "every", "both", "few", "more", "most", "other", "some", "such", "no",
    "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "just", "because", "but", "and", "or", "if", "while", "about", "what",
    "which", "who", "whom", "this", "that", "these", "those", "it", "its",
  ]);

  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w));
}

/** Keyword-matching fallback when AI model is unavailable */
async function keywordFallback(
  root: string,
  query: string,
): Promise<string[]> {
  const { parseHitLog, hashKeywords: hashKw } = await import("./hitlog");
  const files = await findContextFiles(root);
  const keywords = extractKeywords(query);
  const queryHash = hashKw(keywords);

  const scored: Array<{ scope: string; score: number }> = [];

  for (const file of files) {
    const content = (await readContextFile(file)).toLowerCase();
    const scope = relative(root, dirname(file));
    let score = 0;

    for (const kw of keywords) {
      // Count occurrences in content
      let idx = 0;
      while ((idx = content.indexOf(kw, idx)) !== -1) {
        score++;
        idx += kw.length;
      }
      // Bonus: keyword appears in scope path itself
      if (scope.toLowerCase().includes(kw)) {
        score += 5;
      }
    }

    // Hit log bonus: if similar queries previously hit this scope, boost it
    try {
      const hitLog = parseHitLog(content);
      const hitCount = hitLog.filter(h => h.query_hash === queryHash).length;
      if (hitCount > 0) {
        score += hitCount * 3; // Each previous hit adds weight
      }
      // General activity bonus: frequently-hit scopes are more likely relevant
      if (hitLog.length > 5) {
        score += 2;
      }
    } catch {}

    if (score > 0) {
      scored.push({ scope, score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [""];

  // If top score is well ahead, return just the top scope
  // If multiple scopes are close in score, return them all (fan-out)
  const topScore = scored[0].score;
  const threshold = topScore * 0.6;
  const relevant = scored.filter(s => s.score >= threshold && s.scope !== "");

  // If only root matched or no non-root matches
  if (relevant.length === 0) {
    return scored[0].scope === "" ? [""] : [scored[0].scope];
  }

  return relevant.map(s => s.scope);
}

/** Validate scopes against known CONTEXT.md paths, fuzzy-match if needed */
async function validateScopes(root: string, scopes: string[]): Promise<string[]> {
  const files = await findContextFiles(root);
  const knownScopes = new Set(files.map(f => relative(root, dirname(f))));

  return scopes.map(scope => {
    if (knownScopes.has(scope)) return scope; // Exact match

    // Fuzzy match: find the known scope most similar to the target
    let bestMatch = "";
    let bestScore = 0;
    const normalizedTarget = scope.toLowerCase().replace(/[-_]/g, "");

    for (const known of knownScopes) {
      const normalizedKnown = known.toLowerCase().replace(/[-_]/g, "");
      // Check if normalized versions match
      if (normalizedKnown === normalizedTarget) return known;
      // Check if one contains the other
      if (normalizedKnown.includes(normalizedTarget) || normalizedTarget.includes(normalizedKnown)) {
        const score = Math.min(normalizedKnown.length, normalizedTarget.length);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = known;
        }
      }
    }

    return bestMatch || scope; // Fall back to original if no match
  });
}

function buildResult(root: string, targetScopes: string[]): RouteResult {
  if (targetScopes.length === 0) {
    return {
      targetScope: "",
      targetRole: "headmaster",
      contextChain: [join(root, "CONTEXT.md")],
      fanOut: false,
      targets: [{ scope: "", contextPath: join(root, "CONTEXT.md") }],
    };
  }

  const fanOut = targetScopes.length > 1;
  const targets = targetScopes.map(scope => ({
    scope,
    contextPath: join(root, scope, "CONTEXT.md"),
  }));

  const primaryScope = targetScopes[0];
  const contextChain: string[] = [];
  const parts = primaryScope === "" ? [] : primaryScope.split(sep);
  let current = "";
  for (const part of parts) {
    current = current ? join(current, part) : part;
    const ctxPath = join(root, current, "CONTEXT.md");
    contextChain.push(relative(root, ctxPath));
  }

  const depth = primaryScope === "" ? 0 : parts.length;
  const roles = ["headmaster", "dean", "chair", "professor", "pupil"];
  const targetRole = roles[Math.min(depth, roles.length - 1)];

  return {
    targetScope: primaryScope,
    targetRole,
    contextChain,
    fanOut,
    targets,
  };
}

export async function routeQuery(root: string, query: string): Promise<RouteResult> {
  // Try pre-built briefing first, fall back to full scan
  const briefing = await loadBriefing(root);
  const summary = briefing ?? await buildRoutingSummary(root);

  // Try AI model first, fall back to keyword matching
  try {
    const model = getModel("local-fast");

    const result = await generateText({
      model,
      temperature: 0.0,
      system: `You are Contextador Headmaster. Your job is to route queries to the correct scope in the monorepo.

Here are all CONTEXT.md files with previews:
${summary}

Respond with JSON:
{
  "targetScopes": ["scope/path"],
  "reasoning": "brief explanation"
}

Rules:
- If the query clearly maps to ONE specific scope, return just that scope.
- If the query spans multiple scopes, return all relevant scopes.
- Be as specific as possible — prefer deeper scopes over shallow ones.
- Use the exact scope paths from the CONTEXT.md file paths (minus the CONTEXT.md filename).
- For the root scope, use an empty string "".`,
      messages: [{ role: "user", content: query }],
    });

    const parsed = JSON.parse(result.text);
    const targetScopes: string[] = parsed.targetScopes ?? [];

    // Validate AI-generated scopes against actual directories
    const validated = await validateScopes(root, targetScopes);
    return buildResult(root, validated);
  } catch {
    // AI model unavailable — use keyword-matching fallback
    // (keyword fallback already uses real scope paths, no validation needed)
    const targetScopes = await keywordFallback(root, query);
    return buildResult(root, targetScopes);
  }
}
