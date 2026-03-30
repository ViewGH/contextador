#!/usr/bin/env bun
import { writeFile, readFile, mkdir, access } from "fs/promises";
import { join } from "path";

const args = process.argv.slice(2);
const command = args[0];
const flags = new Set(args.slice(1));
const root = process.cwd();

const GLOBAL_CONFIG_DIR = join(process.env.HOME ?? "~", ".contextador");
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");
const PROJECT_CONFIG_PATH = join(root, ".contextador", "config.json");

// ── Helpers ──────────────────────────────────────────────────────

function banner() {
  console.log("");
  console.log("  ◆ Contextador — by View AI");
  console.log("");
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function loadMergedConfig() {
  let global: Record<string, any> = {};
  let project: Record<string, any> = {};
  try { global = JSON.parse(await readFile(GLOBAL_CONFIG_PATH, "utf-8")); } catch {}
  try { project = JSON.parse(await readFile(PROJECT_CONFIG_PATH, "utf-8")); } catch {}
  return { ...global, ...project };
}

// ── Commands ─────────────────────────────────────────────────────

async function cmdSetup() {
  const { runSetup } = await import("./lib/setup/wizard");
  await runSetup();
}

async function cmdInit() {
  banner();
  const { loadConfig, saveConfig, getDefaults } = await import("./lib/core/projectconfig");
  const { findContextFiles, buildHierarchy, buildHierarchyConfig } = await import("./lib/core/hierarchy");
  const { generateBriefing } = await import("./lib/core/briefing");
  const { loadGlobalConfig } = await import("./lib/setup/wizard");

  const globalConfig = await loadGlobalConfig();
  const projectConfig = await loadConfig(root);
  const ctxDir = join(root, ".contextador");
  await mkdir(ctxDir, { recursive: true });

  // Parse -local flag (may include a URL argument)
  const localFlag = args.find(a => a === "-local" || a === "--local");
  let localUrl: string | undefined;
  if (localFlag) {
    const idx = args.indexOf(localFlag);
    const next = args[idx + 1];
    if (next && !next.startsWith("-")) {
      localUrl = next;
    }
  }

  if (localFlag) {
    // Local mode: use AI provider to generate CONTEXT.md files
    const serverUrl = localUrl ?? projectConfig.modelServerUrl;
    console.log(`  Using local provider at ${serverUrl}`);

    const { detectProvider, configure, testConnection } = await import("./lib/providers/config");
    // -local flag forces custom provider with local server URL
    const providerConfig = detectProvider({
      provider: "custom",
      apiKey: "local",
      baseURL: serverUrl,
      model: "local-fast",
    });
    configure(providerConfig);

    process.stdout.write("  Testing connection... ");
    const result = await testConnection();
    if (result.ok) {
      console.log(`✓ Connected (${providerConfig.provider}/${providerConfig.model})`);
    } else {
      console.log(`✗ ${result.error}`);
      console.log("  Run 'contextador setup' to configure your AI provider.");
      process.exit(1);
    }

    // Generate CONTEXT.md files via AI
    console.log("  Generating CONTEXT.md files...\n");
    const { generateContextContent } = await import("./lib/core/generator");
    const { detectNewScopes } = await import("./lib/core/janitor");

    const scopes = await detectNewScopes(root, projectConfig.scanDepth);
    let generated = 0;
    for (const scope of scopes) {
      const contextPath = join(root, scope, "CONTEXT.md");
      if (await fileExists(contextPath)) continue;
      try {
        process.stdout.write(`  → ${scope} `);
        const content = await generateContextContent(root, scope);
        await mkdir(join(root, scope), { recursive: true });
        await writeFile(contextPath, content, "utf-8");
        console.log("✓");
        generated++;
      } catch (err: any) {
        console.log(`✗ ${err.message}`);
      }
    }

    // Also generate root CONTEXT.md if missing
    const rootContext = join(root, "CONTEXT.md");
    if (!await fileExists(rootContext)) {
      try {
        process.stdout.write("  → (root) ");
        const content = await generateContextContent(root, ".");
        await writeFile(rootContext, content, "utf-8");
        console.log("✓");
        generated++;
      } catch (err: any) {
        console.log(`✗ ${err.message}`);
      }
    }

    console.log(`\n  Generated ${generated} CONTEXT.md files`);
  } else {
    // Scaffold-only mode
    console.log("  Scaffolding .contextador/ directory...");
    console.log("  (No AI generation — use 'contextador init -local' or Claude Code)");
  }

  // Build hierarchy and briefing
  console.log("  Building hierarchy...");
  try {
    const hierarchyConfig = await buildHierarchyConfig(root);
    await writeFile(join(ctxDir, "hierarchy.json"), JSON.stringify(hierarchyConfig, null, 2), "utf-8");
  } catch {}

  console.log("  Generating briefing...");
  try {
    const briefing = await generateBriefing(root);
    await writeFile(join(ctxDir, "briefing.md"), briefing, "utf-8");
  } catch {}

  // Save project config with defaults
  await saveConfig(root, projectConfig);

  // Write janitor state
  await writeFile(join(ctxDir, "janitor-state.json"), JSON.stringify({
    lastRun: new Date().toISOString(),
    stages: {},
    changed: false,
  }, null, 2), "utf-8");

  // Create .mcp.json if it doesn't exist
  const mcpPath = join(root, ".mcp.json");
  if (!await fileExists(mcpPath)) {
    const mcpConfig = {
      mcpServers: {
        contextador: {
          command: "bunx",
          args: ["contextador-mcp"],
        },
      },
    };
    await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
    console.log("  Created .mcp.json");
  }

  console.log("\n  ✓ Initialized. CONTEXT.md files are your codebase map.");
  console.log("");
}

async function cmdSweep() {
  banner();
  const { loadConfig } = await import("./lib/core/projectconfig");
  const { runJanitor } = await import("./lib/core/janitor");

  const config = await loadConfig(root);
  let bridge: any = null;

  // Mainframe lock if enabled
  if (config.mainframe.enabled) {
    const { MainframeBridge } = await import("./lib/mainframe/bridge");
    bridge = new MainframeBridge({
      operatorUrl: config.mainframe.operatorUrl,
      projectRoom: config.mainframe.projectRoom,
      alertRoom: config.mainframe.alertRoom,
      budget: { dailyLimit: config.mainframe.dailyTokenLimit },
      enabled: true,
      projectRoot: root,
    });

    const connected = await bridge.connect();
    if (connected) {
      const locked = await bridge.acquireJanitorLock();
      if (!locked) {
        console.log("  Another agent holds the janitor lock. Skipping sweep.");
        bridge.disconnect();
        return;
      }
    }
  }

  console.log("  Running sweep...\n");
  const state = await runJanitor(root);

  // Release lock
  if (bridge) {
    try {
      await bridge.releaseJanitorLock();
      await bridge.summarizeRoom();
    } catch {}
    bridge.disconnect();
  }

  // Summarize
  const { stages } = state;
  for (const [name, result] of Object.entries(stages)) {
    const r = result as { processed: number; actions: string[] };
    if (r.processed > 0) {
      console.log(`  ${name}: ${r.processed} actions`);
      for (const action of r.actions.slice(0, 5)) {
        console.log(`    • ${action}`);
      }
      if (r.actions.length > 5) console.log(`    … and ${r.actions.length - 5} more`);
    }
  }

  console.log(state.changed ? "\n  ✓ Sweep complete — artifacts updated." : "\n  ✓ Sweep complete — nothing changed.");
  console.log("");
}

async function cmdStatus() {
  banner();
  const { findContextFiles } = await import("./lib/core/hierarchy");
  const { detectProvider } = await import("./lib/providers/config");
  const { loadConfig } = await import("./lib/core/projectconfig");
  const { loadGlobalConfig } = await import("./lib/setup/wizard");

  const contextFiles = await findContextFiles(root);
  const globalConfig = await loadGlobalConfig();
  const projectConfig = await loadConfig(root);
  const provider = detectProvider({
    provider: globalConfig?.provider as any,
    apiKey: globalConfig?.apiKey ?? "",
    baseURL: globalConfig?.baseURL ?? "",
    model: globalConfig?.model ?? "",
  });

  console.log(`  CONTEXT.md files: ${contextFiles.length}`);
  console.log(`  Provider: ${provider.provider}${provider.model ? ` (${provider.model})` : ""}`);
  console.log(`  Project config: ${await fileExists(PROJECT_CONFIG_PATH) ? "yes" : "no"}`);
  console.log(`  Global config: ${await fileExists(GLOBAL_CONFIG_PATH) ? "yes" : "no"}`);

  // Mainframe status
  if (projectConfig.mainframe.enabled) {
    console.log(`  Mainframe: enabled (${projectConfig.mainframe.operatorUrl})`);
    try {
      const res = await fetch(`${projectConfig.mainframe.operatorUrl}/_matrix/client/versions`, {
        signal: AbortSignal.timeout(3000),
      });
      console.log(`  Mainframe connection: ${res.ok ? "✓ reachable" : `✗ HTTP ${res.status}`}`);
    } catch {
      console.log("  Mainframe connection: ✗ unreachable");
    }
  } else {
    console.log("  Mainframe: disabled");
  }

  // Janitor state
  try {
    const raw = await readFile(join(root, ".contextador", "janitor-state.json"), "utf-8");
    const state = JSON.parse(raw);
    console.log(`  Last sweep: ${state.lastRun}`);
  } catch {
    console.log("  Last sweep: never");
  }

  console.log("");
}

async function cmdQuery() {
  const query = args.slice(1).filter(a => !a.startsWith("-")).join(" ");
  if (!query) {
    console.error("  Usage: contextador query <question>");
    process.exit(1);
  }

  banner();
  const { routeQuery } = await import("./lib/core/headmaster");

  console.log(`  Routing: "${query}"\n`);
  const result = await routeQuery(root, query);

  console.log(`  Routed to: ${result.targetRole}:${result.targetScope}`);
  console.log(`  Fan out: ${result.fanOut}`);
  console.log(`  Targets (${result.targets.length}):`);
  for (const target of result.targets) {
    console.log(`    → ${target.scope}`);
  }
  console.log("");
}

async function cmdConfigure() {
  banner();
  const { loadConfig, saveConfig } = await import("./lib/core/projectconfig");
  const readline = await import("readline");

  const config = await loadConfig(root);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve));

  console.log("  ─── Project Configuration ───\n");
  console.log("  Current settings (press Enter to keep):\n");

  const modelUrl = await ask(`  Model server URL [${config.modelServerUrl}]: `);
  if (modelUrl.trim()) config.modelServerUrl = modelUrl.trim();

  const minFiles = await ask(`  Min files threshold [${config.minFiles}]: `);
  if (minFiles.trim()) config.minFiles = parseInt(minFiles.trim(), 10) || config.minFiles;

  const scanDepth = await ask(`  Scan depth [${config.scanDepth}]: `);
  if (scanDepth.trim()) config.scanDepth = parseInt(scanDepth.trim(), 10) || config.scanDepth;

  const staleCommits = await ask(`  Stale commit threshold [${config.staleCommitThreshold}]: `);
  if (staleCommits.trim()) config.staleCommitThreshold = parseInt(staleCommits.trim(), 10) || config.staleCommitThreshold;

  const staleDays = await ask(`  Stale days threshold [${config.staleDaysThreshold}]: `);
  if (staleDays.trim()) config.staleDaysThreshold = parseInt(staleDays.trim(), 10) || config.staleDaysThreshold;

  console.log("\n  ─── Mainframe Settings ───\n");

  const mfEnabled = await ask(`  Mainframe enabled [${config.mainframe.enabled}]: `);
  if (mfEnabled.trim()) config.mainframe.enabled = mfEnabled.trim().toLowerCase() === "true" || mfEnabled.trim().toLowerCase() === "yes";

  if (config.mainframe.enabled) {
    const mfUrl = await ask(`  Operator URL [${config.mainframe.operatorUrl}]: `);
    if (mfUrl.trim()) config.mainframe.operatorUrl = mfUrl.trim();

    const mfRoom = await ask(`  Project room [${config.mainframe.projectRoom}]: `);
    if (mfRoom.trim()) config.mainframe.projectRoom = mfRoom.trim();

    const mfAlert = await ask(`  Alert room [${config.mainframe.alertRoom}]: `);
    if (mfAlert.trim()) config.mainframe.alertRoom = mfAlert.trim();

    const mfBudget = await ask(`  Daily token limit [${config.mainframe.dailyTokenLimit}]: `);
    if (mfBudget.trim()) config.mainframe.dailyTokenLimit = parseInt(mfBudget.trim(), 10) || config.mainframe.dailyTokenLimit;
  }

  rl.close();

  await saveConfig(root, config);
  console.log(`\n  ✓ Saved to ${PROJECT_CONFIG_PATH}`);
  console.log("");
}

async function cmdDemolish() {
  banner();
  const { demolish } = await import("./lib/core/demolish");

  console.log("  Removing contextador artifacts...\n");
  const result = await demolish(root);

  if (result.contextadorDirRemoved) console.log("  Removed .contextador/");
  console.log(`  Removed ${result.contextFilesRemoved.length} CONTEXT.md files:`);
  for (const file of result.contextFilesRemoved.slice(0, 20)) {
    console.log(`    − ${file}`);
  }
  if (result.contextFilesRemoved.length > 20) console.log(`    … and ${result.contextFilesRemoved.length - 20} more`);

  if (result.contextFilesKept.length > 0) {
    console.log(`\n  Kept ${result.contextFilesKept.length} user-created files:`);
    for (const file of result.contextFilesKept.slice(0, 10)) {
      console.log(`    ◇ ${file}`);
    }
  }
  if (result.mcpJsonUpdated) console.log("  Cleaned .mcp.json");

  console.log("\n  ✓ Demolished.");
  console.log("");
}

function cmdHelp() {
  banner();
  console.log("  Usage: contextador <command> [flags]\n");
  console.log("  Commands:");
  console.log("    setup       Interactive first-time setup wizard");
  console.log("    init        Initialize contextador in the current project");
  console.log("      -local    Use local AI provider to generate CONTEXT.md files");
  console.log("    sweep       Run the janitor: refresh stale files, sync hierarchy");
  console.log("    status      Show CONTEXT.md counts, provider, mainframe status");
  console.log("    query <q>   Route a query and show matching scopes");
  console.log("    configure   Interactive project config editor");
  console.log("    demolish    Remove all contextador artifacts from the project");
  console.log("    help        Show this help message");
  console.log("");
}

// ── Dispatch ─────────────────────────────────────────────────────

switch (command) {
  case "setup":     await cmdSetup(); break;
  case "init":      await cmdInit(); break;
  case "sweep":     await cmdSweep(); break;
  case "status":    await cmdStatus(); break;
  case "query":     await cmdQuery(); break;
  case "configure": await cmdConfigure(); break;
  case "demolish":  await cmdDemolish(); break;
  case "help":
  case "--help":
  case "-h":
  case undefined:   cmdHelp(); break;
  default:
    console.error(`  Unknown command: ${command}`);
    console.error("  Run 'contextador help' for usage.");
    process.exit(1);
}
