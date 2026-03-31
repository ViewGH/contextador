#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Core imports
import { extractPointers, serializePointers } from "./lib/core/pointers";
import { hashKeywords, recordHit } from "./lib/core/hitlog";
import { processFeedback, type FeedbackType } from "./lib/core/feedback";
import { runJanitor } from "./lib/core/janitor";
import { findContextFiles, readContextFile } from "./lib/core/hierarchy";
import { recordQuery, recordFeedback, recordSweep, loadStats, formatStats } from "./lib/core/stats";
import { checkFreshness } from "./lib/core/freshness";
import { summarizeDirectory } from "./lib/core/generator";
import { routeQuery } from "./lib/core/headmaster";
import { loadConfig } from "./lib/core/projectconfig";

// Mainframe imports
import { MainframeBridge, type MainframeConfig } from "./lib/mainframe/bridge";

// Provider imports
import { detectProvider, configure } from "./lib/providers/config";

// Setup imports
import { loadGlobalConfig } from "./lib/setup/wizard";

import { readFile } from "fs/promises";
import { join, basename, dirname, relative } from "path";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const ROOT = process.env.CONTEXTADOR_ROOT ?? process.cwd();
const dirName = basename(ROOT);

let mainframe: MainframeBridge | null = null;
let mainframePaused = false;

async function bootstrap() {
  // Load global config (~/.contextador/config.json)
  const globalConfig = await loadGlobalConfig();

  // Load project config (.contextador/config.json)
  const projectConfig = await loadConfig(ROOT);

  // Configure AI provider
  if (globalConfig) {
    const providerConfig = detectProvider({
      provider: globalConfig.provider as any,
      apiKey: globalConfig.apiKey,
      baseURL: globalConfig.baseURL,
      model: globalConfig.model,
    });
    configure(providerConfig);
  }

  // Connect mainframe if enabled (non-blocking)
  const mfGlobal = globalConfig?.mainframe;
  const mfProject = projectConfig.mainframe;

  if (mfGlobal?.enabled || mfProject?.enabled) {
    const serverName = mfGlobal?.serverName ?? "localhost";
    const operatorUrl = mfProject?.operatorUrl ?? mfGlobal?.operatorUrl ?? "http://localhost:6167";
    const projectRoom = mfProject?.projectRoom ?? `#ctx-${dirName}:${serverName}`;

    const config: MainframeConfig = {
      operatorUrl,
      projectRoom,
      alertRoom: mfProject?.alertRoom,
      budget: {
        dailyLimit: mfProject?.dailyTokenLimit ?? 50000,
        hourlyLimit: Math.floor((mfProject?.dailyTokenLimit ?? 50000) / 8),
      },
      enabled: true,
      projectRoot: ROOT,
    };

    mainframe = new MainframeBridge(config);
    // Non-blocking connect
    mainframe.connect().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

// Background sweep — runs repair queue without blocking the agent
let sweepInProgress = false;

async function triggerBackgroundSweep(reason: string) {
  if (sweepInProgress) return; // Don't stack sweeps
  sweepInProgress = true;
  try {
    // Only process repair queue + freshness, not the full 5-stage sweep
    const { processRepairQueue, freshnessSweep } = await import("./lib/core/janitor");
    await processRepairQueue(ROOT);
    await freshnessSweep(ROOT);
  } catch {} finally {
    sweepInProgress = false;
  }
}

// Enrich a CONTEXT.md with details from the agent's exploration
// When an agent reports missing files, we read those files and add descriptions
async function enrichFromFeedback(scope: string, missingFiles: string[], detail?: string) {
  const { readFile: rf, writeFile: wf } = await import("fs/promises");
  const contextPath = join(ROOT, scope, "CONTEXT.md");

  let content: string;
  try {
    content = await rf(contextPath, "utf-8");
  } catch {
    return; // No CONTEXT.md to enrich — repair queue will create it
  }

  // For each missing file, try to read it and add a description to Key Files
  for (const filePath of missingFiles) {
    const fullPath = join(ROOT, filePath);
    try {
      const fileContent = await rf(fullPath, "utf-8");
      // Extract a one-line description from the file
      const firstComment = fileContent.match(/^(?:\/\/|#|\/\*|\*|"""|''')\s*(.+)/m);
      const firstExport = fileContent.match(/export (?:class|function|const|interface) (\w+)/);
      const desc = firstComment?.[1]?.trim()
        ?? (firstExport ? `Exports ${firstExport[1]}` : "")
        ?? "";

      // Add or update the file entry in Key Files
      const fileName = filePath.split("/").pop() ?? filePath;
      const entry = desc ? `- \`${fileName}\` — ${desc}` : `- \`${fileName}\``;

      // If the file is already listed (with or without path prefix), replace it
      const existingPattern = new RegExp(`^- \`(?:.*\\/)?${fileName}\`.*$`, "m");
      if (existingPattern.test(content)) {
        content = content.replace(existingPattern, entry);
      } else {
        const keyFilesMatch = content.match(/(## Key Files\s*\n)([\s\S]*?)(\n## |\n*$)/m);
        if (keyFilesMatch) {
          content = content.replace(keyFilesMatch[0], `${keyFilesMatch[1]}${keyFilesMatch[2].trimEnd()}\n${entry}\n${keyFilesMatch[3]}`);
        } else {
          content = content.trimEnd() + `\n\n## Key Files\n${entry}\n`;
        }
      }
    } catch {} // File doesn't exist or can't be read
  }

  // If the agent provided detail about what it learned, add as a note
  if (detail && detail.length > 20) {
    // Check if there's an Architecture or Notes section
    if (!content.includes("## Notes")) {
      content = content.trimEnd() + `\n\n## Notes\n- ${detail}\n`;
    } else {
      content = content.replace(/(## Notes\s*\n)([\s\S]*?)(\n## |\n*$)/m, (match, heading, body, end) => {
        return `${heading}${body.trimEnd()}\n- ${detail}\n${end}`;
      });
    }
  }

  await wf(contextPath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "contextador",
  version: "1.0.0",
});

// 1. context — check mainframe cache first, fall back to local, broadcast result
server.tool(
  "context",
  "Look up contextador pointers for a query. Checks mainframe cache first, falls back to local CONTEXT.md files, then broadcasts the result.",
  {
    query: z.string().describe("Natural language query describing what context you need"),
  },
  async ({ query }) => {
    const keywords = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    const queryHash = hashKeywords(keywords);

    // 1. Check mainframe cache
    if (mainframe && !mainframePaused) {
      try {
        const cached = await mainframe.checkHistory(queryHash);
        if (cached) {
          const cachedOutput = `[mainframe cache hit]\n\n${typeof cached === "string" ? cached : JSON.stringify(cached, null, 2)}`;
          await recordQuery(ROOT, cachedOutput.length, true).catch(() => {});
          return text(cachedOutput);
        }
      } catch {}
    }

    // 2. Route query locally via headmaster
    const route = await routeQuery(ROOT, query);

    // 3. Read and serialize pointers from matched scopes
    const results: string[] = [];
    const pointersMap: Record<string, unknown> = {};

    let needsSweep = false;

    for (const target of route.targets) {
      try {
        const content = await readContextFile(target.contextPath);
        if (!content) {
          // Missing CONTEXT.md — queue for repair and flag for background sweep
          results.push(`[${target.scope || "(root)"}]\n*No CONTEXT.md — queued for generation. Will be available on next query.*`);
          try {
            const { addToRepairQueue } = await import("./lib/core/feedback");
            // Queue via the repair mechanism
            const { mkdir: mkdirFs, readFile: rf, writeFile: wf } = await import("fs/promises");
            const queuePath = join(ROOT, ".contextador", "repair-queue.json");
            await mkdirFs(join(ROOT, ".contextador"), { recursive: true });
            let queue: any[] = [];
            try { queue = JSON.parse(await rf(queuePath, "utf-8")); } catch {}
            if (!queue.some((e: any) => e.scope === target.scope)) {
              queue.push({ scope: target.scope, reason: "missing_context:auto", addedAt: new Date().toISOString().split("T")[0] });
              await wf(queuePath, JSON.stringify(queue, null, 2), "utf-8");
            }
          } catch {}
          needsSweep = true;
          continue;
        }
        const pointers = extractPointers(content, target.scope || "(root)");
        const serialized = serializePointers(pointers);
        results.push(serialized);
        pointersMap[target.scope || "(root)"] = pointers;

        // Record hit
        await recordHit(target.contextPath, queryHash).catch(() => {});
      } catch {}
    }

    // If any scopes were missing CONTEXT.md, trigger background sweep
    if (needsSweep) {
      triggerBackgroundSweep("missing CONTEXT.md detected during query");
    }

    const output = results.length > 0
      ? results.join("\n\n---\n\n")
      : `No context found for: ${query}\n\nRouted to: ${route.targetScope || "(root)"} (${route.targetRole})`;

    // 4. Broadcast to mainframe
    if (mainframe && !mainframePaused && results.length > 0) {
      try {
        await mainframe.postBroadcast(
          query,
          queryHash,
          route.targets.map((t) => t.scope),
          pointersMap,
          output.length,
          "local",
        );
      } catch {}
    }

    await recordQuery(ROOT, output.length, false).catch(() => {});

    const prefix = route.fanOut
      ? `[fan-out: ${route.targets.length} scopes]\n\n`
      : "";

    return text(prefix + output);
  },
);

// 2. context_feedback — report inaccurate context
server.tool(
  "context_feedback",
  "Report inaccurate or missing context so it can be repaired.",
  {
    scope: z.string().describe("Scope path (e.g. 'src/lib/core')"),
    type: z.enum(["missing_context", "build_failure", "wrong_location"]).describe("Type of issue"),
    detail: z.string().optional().describe("Description of what was wrong"),
    missingFiles: z.array(z.string()).optional().describe("Files that should be in Key Files but aren't"),
  },
  async ({ scope, type, detail, missingFiles }) => {
    // Record feedback (adds to Key Files, increments counter, queues repair)
    await processFeedback(ROOT, {
      type: type as FeedbackType,
      scope,
      detail,
      missingFiles,
    });

    await recordFeedback(ROOT).catch(() => {});

    // Trigger background sweep first to create any missing CONTEXT.md stubs
    // Then enrich with the agent's exploration results (runs after sweep)
    const doEnrich = missingFiles && missingFiles.length > 0;
    if (doEnrich || type !== "missing_context") {
      // Run sweep synchronously first to create stubs, then enrich
      if (!sweepInProgress) {
        sweepInProgress = true;
        try {
          const { processRepairQueue } = await import("./lib/core/janitor");
          await processRepairQueue(ROOT);
        } catch {} finally {
          sweepInProgress = false;
        }
      }
    }

    // NOW enrich — after sweep created the stub
    if (doEnrich) {
      await enrichFromFeedback(scope, missingFiles!, detail);
    }

    // Notify mainframe
    if (mainframe && !mainframePaused) {
      try {
        await mainframe.postRequest(
          "any",
          `feedback: ${type} in ${scope} — ${detail ?? "no detail"}`,
          "normal",
        );
      } catch {}
    }

    return text(`Feedback recorded for ${scope}: ${type}${detail ? ` — ${detail}` : ""}. Context enriched and background sweep queued.`);
  },
);

// 3. context_status — freshness + mainframe status
server.tool(
  "context_status",
  "Check freshness of context files and mainframe connection status.",
  {
    scope: z.string().optional().describe("Specific scope to check (omit for overview)"),
  },
  async ({ scope }) => {
    const lines: string[] = [];

    if (scope) {
      // Check specific scope
      const contextPath = join(ROOT, scope, "CONTEXT.md");
      try {
        const check = await checkFreshness(ROOT, contextPath);
        lines.push(`Scope: ${scope}`);
        lines.push(`Fresh: ${check.fresh}`);
        lines.push(`Stale: ${check.stale} (${check.staleSeverity})`);
        lines.push(`Since: ${check.staleSince}`);
        lines.push(`Commits behind: ${check.commitsBehind}`);
        lines.push(`Days behind: ${check.daysBehind}`);
      } catch {
        lines.push(`Scope ${scope}: CONTEXT.md not found or unreadable`);
      }
    } else {
      // Overview
      try {
        const files = await findContextFiles(ROOT);
        let fresh = 0;
        let stale = 0;
        let missing = 0;

        for (const file of files) {
          try {
            const check = await checkFreshness(ROOT, file);
            if (check.fresh) fresh++;
            else stale++;
          } catch {
            missing++;
          }
        }

        lines.push(`Context files: ${files.length}`);
        lines.push(`Fresh: ${fresh}`);
        lines.push(`Stale: ${stale}`);
        lines.push(`Unreadable: ${missing}`);
      } catch {
        lines.push("No context files found");
      }
    }

    // Mainframe status
    lines.push("");
    if (mainframe && !mainframePaused) {
      const status = mainframe.getStatus();
      lines.push(`Mainframe: ${status.connected ? "connected" : "disconnected"}`);
      lines.push(`Agent ID: ${status.agentId}`);
      lines.push(`Room: ${status.roomId ?? "none"}`);
      lines.push(`Budget: ${status.budget.usedToday}/${status.budget.dailyLimit} tokens today`);
      if (status.budget.killed) lines.push("Budget: KILLED");
    } else if (mainframePaused) {
      lines.push("Mainframe: paused (kill switch active)");
    } else {
      lines.push("Mainframe: not configured");
    }

    return text(lines.join("\n"));
  },
);

// 4. context_sweep — janitor with mainframe lock
server.tool(
  "context_sweep",
  "Run the janitor: repair queue, freshness sweep, scope detection, dependency scan, hit log cleanup. Acquires mainframe lock to prevent concurrent sweeps.",
  {},
  async () => {
    // Acquire mainframe lock
    let hasLock = true;
    if (mainframe && !mainframePaused) {
      try {
        hasLock = await mainframe.acquireJanitorLock();
      } catch {
        hasLock = true; // On error, proceed locally
      }
    }

    if (!hasLock) {
      return text("Another agent holds the janitor lock. Try again later.");
    }

    try {
      const state = await runJanitor(ROOT);
      await recordSweep(ROOT).catch(() => {});

      const lines: string[] = [];
      lines.push(`Janitor completed at ${state.lastRun}`);
      lines.push(`Changes detected: ${state.changed}`);
      lines.push("");

      for (const [stage, result] of Object.entries(state.stages)) {
        lines.push(`[${stage}] processed: ${result.processed}`);
        for (const action of result.actions) {
          lines.push(`  ${action}`);
        }
      }

      return text(lines.join("\n"));
    } finally {
      // Release mainframe lock
      if (mainframe && !mainframePaused) {
        try {
          await mainframe.releaseJanitorLock();
        } catch {}
      }
    }
  },
);

// 5. context_stats — usage statistics
server.tool(
  "context_stats",
  "Show contextador usage statistics — queries served, tokens saved, cache hits.",
  {},
  async () => {
    const stats = await loadStats(ROOT);
    const contextFiles = await findContextFiles(ROOT);
    return text(formatStats(stats, contextFiles.length));
  },
);

// 6. context_init — scaffold project
server.tool(
  "context_init",
  "Initialize contextador in a project: create .contextador/ directory, generate root CONTEXT.md, and detect initial scopes.",
  {
    root: z.string().optional().describe("Project root (defaults to CONTEXTADOR_ROOT or cwd)"),
  },
  async ({ root: customRoot }) => {
    const targetRoot = customRoot ?? ROOT;
    const { mkdir, writeFile } = await import("fs/promises");

    // Create .contextador directory
    await mkdir(join(targetRoot, ".contextador"), { recursive: true });

    // Save default project config
    const { saveConfig, getDefaults } = await import("./lib/core/projectconfig");
    const config = getDefaults();
    await saveConfig(targetRoot, config);

    // Generate root CONTEXT.md if it doesn't exist
    const rootContextPath = join(targetRoot, "CONTEXT.md");
    let rootCreated = false;
    try {
      await readFile(rootContextPath, "utf-8");
    } catch {
      const { generateContextContent } = await import("./lib/core/generator");
      try {
        const content = await generateContextContent(targetRoot, "");
        await writeFile(rootContextPath, content, "utf-8");
        rootCreated = true;
      } catch {
        // Fallback stub
        const stub = [
          "---",
          "last_validated: unknown",
          `validated_at: ${new Date().toISOString().split("T")[0]}`,
          "---",
          "",
          `# ${basename(targetRoot)}`,
          "",
          "## Purpose",
          "TODO: Describe this project.",
          "",
          "## Key Files",
          "- TODO",
          "",
        ].join("\n");
        await writeFile(rootContextPath, stub, "utf-8");
        rootCreated = true;
      }
    }

    // Detect scopes
    const { detectNewScopes } = await import("./lib/core/janitor");
    const newScopes = await detectNewScopes(targetRoot);

    const lines: string[] = [];
    lines.push(`Initialized contextador in ${targetRoot}`);
    lines.push(`  .contextador/config.json created`);
    if (rootCreated) lines.push(`  CONTEXT.md created at root`);
    else lines.push(`  CONTEXT.md already exists at root`);
    lines.push(`  Detected ${newScopes.length} scope(s) needing CONTEXT.md:`);
    for (const scope of newScopes.slice(0, 20)) {
      lines.push(`    ${scope}`);
    }
    if (newScopes.length > 20) {
      lines.push(`    ... and ${newScopes.length - 20} more`);
    }
    lines.push("");
    lines.push("Next: run context_sweep to generate CONTEXT.md files for detected scopes.");

    return text(lines.join("\n"));
  },
);

// 6. context_generate — return directory info for CONTEXT.md authoring
server.tool(
  "context_generate",
  "Summarize a directory's contents to help author or update a CONTEXT.md file.",
  {
    scope: z.string().describe("Scope path relative to project root (e.g. 'src/lib/core')"),
  },
  async ({ scope }) => {
    const dirPath = scope ? join(ROOT, scope) : ROOT;
    const files = await summarizeDirectory(dirPath);

    const lines: string[] = [];
    lines.push(`Directory: ${scope || "(root)"}`);
    lines.push(`Files: ${files.length}`);
    lines.push("");

    // Group by extension
    const byExt = new Map<string, string[]>();
    for (const f of files) {
      const ext = f.includes(".") ? "." + f.split(".").pop() : "(no ext)";
      if (!byExt.has(ext)) byExt.set(ext, []);
      byExt.get(ext)!.push(relative(ROOT, f));
    }

    for (const [ext, paths] of [...byExt.entries()].sort()) {
      lines.push(`${ext} (${paths.length}):`);
      for (const p of paths.slice(0, 10)) {
        lines.push(`  ${p}`);
      }
      if (paths.length > 10) {
        lines.push(`  ... and ${paths.length - 10} more`);
      }
    }

    return text(lines.join("\n"));
  },
);

// 7. mainframe_pause — kill switch
server.tool(
  "mainframe_pause",
  "Pause mainframe communication (kill switch). Local operations continue normally.",
  {},
  async () => {
    if (!mainframe) {
      return text("Mainframe is not configured.");
    }
    mainframe.kill();
    mainframePaused = true;
    return text("Mainframe paused. All communication stopped. Local operations continue.");
  },
);

// 8. mainframe_resume — resume
server.tool(
  "mainframe_resume",
  "Resume mainframe communication after a pause.",
  {},
  async () => {
    if (!mainframe) {
      return text("Mainframe is not configured.");
    }
    mainframe.resume();
    mainframePaused = false;
    return text("Mainframe resumed. Communication restored.");
  },
);

// 9. mainframe_tasks — check pending task requests
server.tool(
  "mainframe_tasks",
  "Check for pending task requests from other agents on the mainframe.",
  {},
  async () => {
    if (!mainframe || mainframePaused) {
      return text(mainframePaused ? "Mainframe is paused." : "Mainframe is not configured.");
    }

    try {
      const requests = await mainframe.checkForRequests();
      if (requests.length === 0) {
        return text("No pending task requests.");
      }

      const lines: string[] = [`${requests.length} pending task(s):\n`];
      for (const req of requests) {
        lines.push(`  From: ${req.from}`);
        lines.push(`  Task: ${req.task}`);
        lines.push(`  Priority: ${req.priority}`);
        lines.push("");
      }

      return text(lines.join("\n"));
    } catch {
      return text("Failed to check mainframe tasks (connection issue).");
    }
  },
);

// 10. mainframe_request — post task for another agent
server.tool(
  "mainframe_request",
  "Post a task request for another agent on the mainframe.",
  {
    to: z.string().describe("Target agent ID or 'any' for any available agent"),
    task: z.string().describe("Description of the task to request"),
    priority: z.enum(["normal", "high"]).optional().describe("Task priority (default: normal)"),
  },
  async ({ to, task, priority }) => {
    if (!mainframe || mainframePaused) {
      return text(mainframePaused ? "Mainframe is paused." : "Mainframe is not configured.");
    }

    try {
      await mainframe.postRequest(to, task, priority ?? "normal");
      return text(`Task request posted to ${to}: ${task}`);
    } catch {
      return text("Failed to post task request (connection issue).");
    }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  await bootstrap();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
