import { readFile, writeFile, mkdir, readdir, stat, access } from "fs/promises";
import { join, relative, dirname, sep } from "path";
import { findContextFiles, readContextFile, buildHierarchyConfig } from "./hierarchy";
import { checkFreshness, stampContextFile } from "./freshness";
import { pruneHitLog, parseHitLog } from "./hitlog";
import { generateBriefing } from "./briefing";
import { generateContextContent } from "./generator";
import { syncServiceIndex, syncArchitectureDeps } from "./docsync";
import { scanAllDependencies } from "./depscan";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target", "__pycache__", ".contextador"]);
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java",
  ".c", ".cpp", ".h", ".cs", ".rb", ".swift", ".kt", ".scala",
  ".vue", ".svelte", ".astro",
]);

interface RepairEntry {
  scope: string;
  reason: string;
  addedAt?: string;
}

interface JanitorStageResult {
  processed: number;
  actions: string[];
}

interface JanitorState {
  lastRun: string;
  stages: Record<string, JanitorStageResult>;
  changed: boolean;
}

async function ensureContextadorDir(root: string): Promise<string> {
  const dir = join(root, ".contextador");
  await mkdir(dir, { recursive: true });
  return dir;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function dirHasCode(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = entry.name.includes(".") ? "." + entry.name.split(".").pop() : "";
        if (CODE_EXTENSIONS.has(ext)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function generateStubContext(scope: string): string {
  const name = scope.split(sep).pop() || scope;
  return [
    "---",
    `last_validated: unknown`,
    `validated_at: ${new Date().toISOString().split("T")[0]}`,
    "---",
    "",
    `# ${name}`,
    "",
    "## Purpose",
    "TODO: Describe this scope's purpose.",
    "",
    "## Key Files",
    "- TODO",
    "",
  ].join("\n");
}

/**
 * Stage 1: Process the repair queue.
 * Reads `.contextador/repair-queue.json`, generates missing CONTEXT.md stubs,
 * and stamps stale ones.
 */
export async function processRepairQueue(root: string): Promise<JanitorStageResult> {
  const ctxDir = await ensureContextadorDir(root);
  const queuePath = join(ctxDir, "repair-queue.json");
  const actions: string[] = [];

  let queue: RepairEntry[] = [];
  try {
    const raw = await readFile(queuePath, "utf-8");
    queue = JSON.parse(raw);
    if (!Array.isArray(queue)) queue = [];
  } catch {
    // No queue file or invalid JSON — nothing to process
    return { processed: 0, actions: [] };
  }

  if (queue.length === 0) {
    return { processed: 0, actions: [] };
  }

  const remaining: RepairEntry[] = [];

  for (const entry of queue) {
    const scopeDir = join(root, entry.scope);
    const contextPath = join(scopeDir, "CONTEXT.md");

    try {
      if (!(await fileExists(contextPath))) {
        // Generate CONTEXT.md with AI content, falling back to stub
        await mkdir(scopeDir, { recursive: true });
        let content: string;
        try {
          content = await generateContextContent(root, entry.scope);
        } catch {
          content = generateStubContext(entry.scope);
        }
        await writeFile(contextPath, content, "utf-8");
        actions.push(`created stub: ${entry.scope}`);
      } else {
        // Stamp stale ones
        const check = await checkFreshness(root, contextPath);
        if (check.stale) {
          await stampContextFile(root, contextPath);
          actions.push(`stamped stale: ${entry.scope}`);
        } else {
          actions.push(`already fresh: ${entry.scope}`);
        }
      }
    } catch (err) {
      // If we can't process this entry, keep it for next run
      remaining.push(entry);
      actions.push(`failed: ${entry.scope} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Write back any remaining (failed) entries
  await writeFile(queuePath, JSON.stringify(remaining, null, 2), "utf-8");

  return { processed: queue.length - remaining.length, actions };
}

/** Parse feedback counters from CONTEXT.md content */
function parseFeedbackRatio(content: string): { failures: number; successes: number; ratio: number } {
  const failMatch = content.match(/feedback_failures:\s*(\d+)/);
  const succMatch = content.match(/feedback_successes:\s*(\d+)/);
  const failures = failMatch ? parseInt(failMatch[1], 10) : 0;
  const successes = succMatch ? parseInt(succMatch[1], 10) : 0;
  const total = failures + successes;
  const ratio = total > 0 ? failures / total : 0;
  return { failures, successes, ratio };
}

/**
 * Stage 2: Freshness sweep.
 * Walks all CONTEXT.md files, stamps stale ones, and uses feedback ratio
 * to decide regeneration priority. High-failure CONTEXT.md files get
 * regenerated even if only minor-stale. High-success files get skipped
 * if only minor-stale (they're working fine).
 */
export async function freshnessSweep(root: string): Promise<JanitorStageResult> {
  const actions: string[] = [];
  let processed = 0;

  let files: string[];
  try {
    files = await findContextFiles(root);
  } catch {
    return { processed: 0, actions: ["failed to find context files"] };
  }

  for (const file of files) {
    try {
      const content = await readFile(file, "utf-8");
      const check = await checkFreshness(root, file);
      const feedback = parseFeedbackRatio(content);
      const scope = relative(root, dirname(file));

      if (!check.stale) {
        // Not stale by commit — but check if feedback ratio is terrible
        if (feedback.ratio > 0.5 && feedback.failures >= 3) {
          // More than 50% failure rate with 3+ failures: regenerate regardless
          try {
            const newContent = await generateContextContent(root, scope);
            await writeFile(file, newContent, "utf-8");
            actions.push(`regenerated (high failure rate ${feedback.failures}/${feedback.failures + feedback.successes}): ${scope}`);
            processed++;
          } catch {
            actions.push(`regen failed (high failure rate): ${scope}`);
          }
        }
        continue;
      }

      // Stale — decide based on severity + feedback ratio
      const shouldRegenerate =
        check.staleSeverity === "major" ||
        (check.staleSeverity === "minor" && feedback.ratio > 0.3); // Minor stale + poor feedback → regenerate

      const shouldSkip =
        check.staleSeverity === "minor" &&
        feedback.successes > 5 &&
        feedback.ratio < 0.1; // Minor stale + high success → skip, it's working fine

      if (shouldSkip) {
        await stampContextFile(root, file);
        actions.push(`skipped (high success rate): ${scope}`);
        processed++;
      } else if (shouldRegenerate) {
        try {
          const newContent = await generateContextContent(root, scope);
          await writeFile(file, newContent, "utf-8");
          actions.push(`regenerated: ${scope} — ${check.staleSince}`);
        } catch {
          await stampContextFile(root, file);
          actions.push(`stamped (regen failed): ${scope}`);
        }
        processed++;
      } else {
        await stampContextFile(root, file);
        actions.push(`stamped: ${scope} — ${check.staleSince}`);
        processed++;
      }
    } catch {
      // Skip files we can't process
    }
  }

  return { processed, actions };
}

/**
 * Stage 3: Detect new scopes.
 * Finds directories with code files but no CONTEXT.md, up to max depth 3.
 */
export async function detectNewScopes(root: string, maxDepth = 6): Promise<string[]> {
  const discovered: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasContext = entries.some(e => e.isFile() && e.name === "CONTEXT.md");

    if (!hasContext && depth > 0) {
      const hasCode = await dirHasCode(dir);
      if (hasCode) {
        discovered.push(relative(root, dir));
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  return discovered;
}

/**
 * Stage 4: Cleanup hit logs.
 * Prunes old hit entries from all CONTEXT.md files.
 */
export async function cleanupHitLogs(root: string): Promise<JanitorStageResult> {
  const actions: string[] = [];
  let processed = 0;

  let files: string[];
  try {
    files = await findContextFiles(root);
  } catch {
    return { processed: 0, actions: ["failed to find context files"] };
  }

  for (const file of files) {
    try {
      const content = await readContextFile(file);
      const hits = parseHitLog(content);
      if (hits.length === 0) continue;

      const pruned = pruneHitLog(hits);
      if (pruned.length < hits.length) {
        const scope = relative(root, dirname(file));
        actions.push(`pruned ${hits.length - pruned.length} entries: ${scope || "(root)"}`);
        processed++;
        // Note: We don't rewrite here because parseHitLog currently returns []
        // for the standard frontmatter format. When hit_log is stored in a
        // separate file in future, this will do the actual pruning write.
      }
    } catch {
      // Skip files we can't process
    }
  }

  return { processed, actions };
}

/**
 * Stage 5: Dependency scan.
 * Detects cross-scope imports and adds missing dependency entries to CONTEXT.md files.
 */
export async function dependencyScan(root: string): Promise<JanitorStageResult> {
  const actions: string[] = [];
  let processed = 0;

  let files: string[];
  try {
    files = await findContextFiles(root);
  } catch {
    return { processed: 0, actions: ["failed to find context files"] };
  }

  let depsMap: Map<string, { consumes: string[]; implementsFor: string[] }>;
  try {
    depsMap = await scanAllDependencies(root);
  } catch {
    return { processed: 0, actions: ["failed to scan dependencies"] };
  }

  for (const file of files) {
    const scope = relative(root, dirname(file));
    if (!scope) continue;

    const deps = depsMap.get(scope);
    if (!deps) continue;
    if (deps.consumes.length === 0 && deps.implementsFor.length === 0) continue;

    try {
      const content = await readFile(file, "utf-8");
      const depsSection = content.match(/## Dependencies\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";

      const missingConsumes = deps.consumes.filter(d => !depsSection.includes(d));
      const missingImplements = deps.implementsFor.filter(d => !depsSection.includes(d));
      if (missingConsumes.length === 0 && missingImplements.length === 0) continue;

      const lines: string[] = [];
      for (const d of missingConsumes) {
        lines.push(`- **Downstream:** ${d} (consumes)`);
      }
      for (const d of missingImplements) {
        lines.push(`- **Upstream:** ${d} (implements for)`);
      }
      const additions = lines.join("\n");

      let updated: string;
      if (content.includes("## Dependencies")) {
        updated = content.replace(
          /(## Dependencies\n[\s\S]*?)(\n## |$)/,
          (match, before, after) => `${before}\n${additions}${after}`
        );
      } else {
        updated = content.trimEnd() + `\n\n## Dependencies\n${additions}\n`;
      }

      await writeFile(file, updated, "utf-8");
      const total = missingConsumes.length + missingImplements.length;
      actions.push(`${scope}: added ${total} deps (${[...missingConsumes, ...missingImplements].join(", ")})`);
      processed++;
    } catch {
      // Individual scope failures should not stop the sweep
    }
  }

  return { processed, actions };
}

/**
 * Stage 6 (orchestrator): Run all janitor stages in order.
 * Regenerates briefing.md and hierarchy.json if anything changed.
 * Saves janitor-state.json.
 */
export async function runJanitor(root: string): Promise<JanitorState> {
  const ctxDir = await ensureContextadorDir(root);
  let changed = false;

  // Stage 1: Repair queue
  const repairResult = await processRepairQueue(root);
  if (repairResult.processed > 0) changed = true;

  // Stage 2: Freshness sweep
  const freshnessResult = await freshnessSweep(root);
  if (freshnessResult.processed > 0) changed = true;

  // Stage 3: Structural detection
  const newScopes = await detectNewScopes(root);
  const detectResult: JanitorStageResult = {
    processed: newScopes.length,
    actions: newScopes.map(s => `new scope: ${s}`),
  };
  if (newScopes.length > 0) {
    changed = true;
    // Add discovered scopes to repair queue for next run
    const queuePath = join(ctxDir, "repair-queue.json");
    let existing: RepairEntry[] = [];
    try {
      existing = JSON.parse(await readFile(queuePath, "utf-8"));
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }
    const existingScopes = new Set(existing.map(e => e.scope));
    for (const scope of newScopes) {
      if (!existingScopes.has(scope)) {
        existing.push({
          scope,
          reason: "auto-detected by janitor",
          addedAt: new Date().toISOString().split("T")[0],
        });
      }
    }
    await writeFile(queuePath, JSON.stringify(existing, null, 2), "utf-8");
  }

  // Stage 4: Dependency scan
  const depscanResult = await dependencyScan(root);
  if (depscanResult.processed > 0) changed = true;

  // Stage 5: Hit log cleanup
  const hitlogResult = await cleanupHitLogs(root);
  if (hitlogResult.processed > 0) changed = true;

  // Stage 6: Regenerate artifacts if anything changed
  const docSyncActions: string[] = [];
  if (changed) {
    try {
      const briefing = await generateBriefing(root);
      await writeFile(join(ctxDir, "briefing.md"), briefing, "utf-8");
      docSyncActions.push("regenerated briefing.md");
    } catch (err) {
      docSyncActions.push(`briefing failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const config = await buildHierarchyConfig(root);
      await writeFile(join(ctxDir, "hierarchy.json"), JSON.stringify(config, null, 2), "utf-8");
      docSyncActions.push("regenerated hierarchy.json");
    } catch (err) {
      docSyncActions.push(`hierarchy failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await syncServiceIndex(root);
      docSyncActions.push("regenerated service-index.md");
    } catch (err) {
      docSyncActions.push(`service-index failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await syncArchitectureDeps(root);
      docSyncActions.push("regenerated architecture.md deps");
    } catch (err) {
      docSyncActions.push(`architecture-deps failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const docSyncResult: JanitorStageResult = {
    processed: docSyncActions.length,
    actions: docSyncActions,
  };

  const state: JanitorState = {
    lastRun: new Date().toISOString(),
    stages: {
      repairQueue: repairResult,
      freshnessSweep: freshnessResult,
      detectNewScopes: detectResult,
      dependencyScan: depscanResult,
      cleanupHitLogs: hitlogResult,
      docSync: docSyncResult,
    },
    changed,
  };

  await writeFile(join(ctxDir, "janitor-state.json"), JSON.stringify(state, null, 2), "utf-8");

  return state;
}
