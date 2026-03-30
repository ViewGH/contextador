/**
 * Triage — decides whether a push warrants a context sweep.
 *
 * Flow:
 * 1. Extract changed files from the push payload
 * 2. Map changed files → affected scopes (directories with CONTEXT.md)
 * 3. For each affected scope, check if CONTEXT.md already covers the changes
 * 4. Ask the local model: "Given this diff and existing context, is an update needed?"
 * 5. Return TriageResult with the verdict
 */

import { readFile } from "fs/promises";
import { join, dirname, relative } from "path";
import { generateText } from "ai";
import { getModel } from "../providers/config";
import { findContextFiles } from "../core/hierarchy";
import { checkFreshness } from "../core/freshness";
import type { GitHubPushPayload, TriageResult } from "./types";

const TRIVIAL_PATTERNS = [
  /^\.github\//,             // CI/CD configs
  /^\.gitignore$/,
  /^\.eslintrc/,
  /^\.prettier/,
  /^LICENSE/,
  /^CHANGELOG/,
  /\.lock$/,                 // lockfiles (bun.lock, yarn.lock, etc.)
  /package-lock\.json$/,     // npm lockfile
  /pnpm-lock\.yaml$/,        // pnpm lockfile
  /\.snap$/,                 // snapshots
  /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/, // assets
];

const CONTEXT_SKIP = ["CONTEXT.md", ".contextador/"];

/**
 * Extract all changed files from a push payload.
 */
export function extractChangedFiles(payload: GitHubPushPayload): {
  added: string[];
  modified: string[];
  removed: string[];
  all: string[];
} {
  const added = new Set<string>();
  const modified = new Set<string>();
  const removed = new Set<string>();

  for (const commit of payload.commits) {
    for (const f of commit.added) added.add(f);
    for (const f of commit.modified) modified.add(f);
    for (const f of commit.removed) removed.add(f);
  }

  const all = new Set([...added, ...modified, ...removed]);

  return {
    added: [...added],
    modified: [...modified],
    removed: [...removed],
    all: [...all],
  };
}

/**
 * Filter out trivial files that never affect context quality.
 */
export function filterTrivialFiles(files: string[]): string[] {
  return files.filter((f) => {
    // Skip contextador's own files
    if (CONTEXT_SKIP.some((skip) => f.includes(skip))) return false;
    // Skip trivial patterns
    if (TRIVIAL_PATTERNS.some((pat) => pat.test(f))) return false;
    return true;
  });
}

/**
 * Map changed files to the scopes (directories) they belong to.
 * Returns scope paths relative to repo root.
 */
export function mapFilesToScopes(
  files: string[],
  knownScopes: string[],
): Map<string, string[]> {
  const scopeMap = new Map<string, string[]>();

  for (const file of files) {
    const dir = dirname(file);

    // Find the deepest known scope that contains this file
    let bestScope = "";
    for (const scope of knownScopes) {
      if (dir === scope || dir.startsWith(scope + "/")) {
        if (scope.length > bestScope.length) {
          bestScope = scope;
        }
      }
    }

    // If no scope found, use the top-level directory
    if (!bestScope) {
      bestScope = dir.split("/")[0] || ".";
    }

    if (!scopeMap.has(bestScope)) {
      scopeMap.set(bestScope, []);
    }
    scopeMap.get(bestScope)!.push(file);
  }

  return scopeMap;
}

/**
 * Get the git diff for a range of commits.
 * Returns the raw diff text.
 */
async function getGitDiff(root: string, beforeSha: string, afterSha: string): Promise<string> {
  try {
    const proc = Bun.spawn(
      ["git", "diff", "--stat", "--no-color", `${beforeSha}...${afterSha}`],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim();
  } catch {
    return "(diff unavailable)";
  }
}

/**
 * Get a compact diff for specific files (context-relevant changes only).
 */
async function getScopeDiff(
  root: string,
  beforeSha: string,
  afterSha: string,
  files: string[],
): Promise<string> {
  try {
    const proc = Bun.spawn(
      ["git", "diff", "--no-color", "-U3", `${beforeSha}...${afterSha}`, "--", ...files],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    // Truncate to avoid sending megabytes to the model
    return output.slice(0, 8000);
  } catch {
    return "(diff unavailable)";
  }
}

/**
 * Read existing CONTEXT.md for a scope.
 */
async function readScopeContext(root: string, scope: string): Promise<string> {
  try {
    const contextPath = join(root, scope, "CONTEXT.md");
    return await readFile(contextPath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Ask the local model whether the existing CONTEXT.md already covers
 * the changes in this diff, or if a regeneration is needed.
 */
export async function triageScope(
  root: string,
  scope: string,
  files: string[],
  beforeSha: string,
  afterSha: string,
): Promise<{ needsUpdate: boolean; reason: string }> {
  const existingContext = await readScopeContext(root, scope);
  const diff = await getScopeDiff(root, beforeSha, afterSha, files);

  // No existing CONTEXT.md → always needs update
  if (!existingContext) {
    return { needsUpdate: true, reason: "no existing CONTEXT.md" };
  }

  // If the diff is tiny (< 20 lines), check if it's just formatting
  const diffLines = diff.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-")).length;
  if (diffLines < 5) {
    return { needsUpdate: false, reason: `trivial change (${diffLines} lines)` };
  }

  try {
    const model = getModel();
    const result = await generateText({
      model,
      prompt: `You are a context freshness evaluator. Given an existing CONTEXT.md and a code diff, decide if the CONTEXT.md needs to be regenerated.

CONTEXT.md covers: purpose, key files, architecture, dependencies, and API surface for a code scope.

Rules:
- If the diff only changes IMPLEMENTATION DETAILS (bug fixes, refactors, variable renames) and the CONTEXT.md already describes the correct architecture → NO UPDATE needed
- If the diff ADDS NEW FILES, RENAMES KEY FILES, CHANGES EXPORTS, or CHANGES ARCHITECTURE → UPDATE needed
- If the diff REMOVES FILES listed in Key Files → UPDATE needed
- If the diff changes the PURPOSE or adds a new major feature → UPDATE needed

Existing CONTEXT.md:
${existingContext.slice(0, 3000)}

Changed files in this scope: ${files.join(", ")}

Diff (truncated):
${diff.slice(0, 4000)}

Respond with EXACTLY one line:
UPDATE: <reason> — if the context needs regeneration
SKIP: <reason> — if the existing context already covers this change`,
      maxTokens: 100,
    });

    const response = result.text.trim();
    if (response.startsWith("UPDATE:")) {
      return { needsUpdate: true, reason: response.slice(7).trim() };
    }
    return { needsUpdate: false, reason: response.slice(5).trim() || "existing context is sufficient" };
  } catch (err) {
    // If model is unavailable, fall back to heuristic: >20 lines changed in a scope → update
    if (diffLines > 20) {
      return { needsUpdate: true, reason: `model unavailable, ${diffLines} lines changed (heuristic)` };
    }
    return { needsUpdate: false, reason: `model unavailable, ${diffLines} lines changed (below heuristic threshold)` };
  }
}

/**
 * Full triage pipeline for a push event.
 */
export async function triagePush(
  root: string,
  payload: GitHubPushPayload,
): Promise<TriageResult> {
  const changed = extractChangedFiles(payload);
  const meaningful = filterTrivialFiles(changed.all);

  // Nothing meaningful changed
  if (meaningful.length === 0) {
    return {
      shouldUpdate: false,
      reason: "all changes are trivial (assets, lockfiles, CI configs)",
      affectedScopes: [],
      diffSummary: `${changed.all.length} files changed, all trivial`,
      filesChanged: changed.all.length,
      linesChanged: 0,
    };
  }

  // Get known scopes from existing CONTEXT.md files
  let contextFiles: string[] = [];
  try {
    contextFiles = await findContextFiles(root);
  } catch {
    // No context files yet
  }
  const knownScopes = contextFiles.map((f) => relative(root, dirname(f)));

  // Map files → scopes
  const scopeMap = mapFilesToScopes(meaningful, knownScopes);

  // Triage each scope
  const needsUpdate: string[] = [];
  const reasons: string[] = [];

  for (const [scope, files] of scopeMap) {
    const result = await triageScope(root, scope, files, payload.before, payload.after);
    if (result.needsUpdate) {
      needsUpdate.push(scope);
      reasons.push(`${scope}: ${result.reason}`);
    }
  }

  // Get overall diff summary
  const diffSummary = await getGitDiff(root, payload.before, payload.after);
  const linesMatch = diffSummary.match(/(\d+) insertions?\(\+\).*?(\d+) deletions?\(-\)/);
  const linesChanged = linesMatch ? parseInt(linesMatch[1]) + parseInt(linesMatch[2]) : 0;

  return {
    shouldUpdate: needsUpdate.length > 0,
    reason: needsUpdate.length > 0
      ? `${needsUpdate.length} scope(s) need update: ${reasons.join("; ")}`
      : `${scopeMap.size} scope(s) checked, all context is sufficient`,
    affectedScopes: needsUpdate,
    diffSummary,
    filesChanged: meaningful.length,
    linesChanged,
  };
}
