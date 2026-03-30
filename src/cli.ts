#!/usr/bin/env bun
import { writeFile, readFile, mkdir, access } from "fs/promises";
import { join } from "path";
import { banner, success, error, warn, info, step, stepDone, stepFail, heading, stat, divider, c } from "./lib/ui";

const args = process.argv.slice(2);
const command = args[0];
const flags = new Set(args.slice(1));
const root = process.cwd();

const GLOBAL_CONFIG_DIR = join(process.env.HOME ?? "~", ".contextador");
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");
const PROJECT_CONFIG_PATH = join(root, ".contextador", "config.json");

// ── Helpers ──────────────────────────────────────────────────────

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
  const { loadConfig, saveConfig } = await import("./lib/core/projectconfig");
  const { findContextFiles, buildHierarchyConfig } = await import("./lib/core/hierarchy");
  const { generateBriefing } = await import("./lib/core/briefing");
  const { loadGlobalConfig } = await import("./lib/setup/wizard");

  const globalConfig = await loadGlobalConfig();
  const projectConfig = await loadConfig(root);

  if (globalConfig?.mainframe?.enabled && !projectConfig.mainframe.enabled) {
    projectConfig.mainframe.enabled = globalConfig.mainframe.enabled;
    projectConfig.mainframe.operatorUrl = globalConfig.mainframe.operatorUrl ?? projectConfig.mainframe.operatorUrl;
  }

  const ctxDir = join(root, ".contextador");
  await mkdir(ctxDir, { recursive: true });
  await saveConfig(root, projectConfig);

  const localFlag = args.find(a => a === "-local" || a === "--local");
  let localUrl: string | undefined;
  if (localFlag) {
    const idx = args.indexOf(localFlag);
    const next = args[idx + 1];
    if (next && !next.startsWith("-")) localUrl = next;
  }

  if (localFlag) {
    const serverUrl = localUrl ?? projectConfig.modelServerUrl;
    heading("AI Generation");
    info(`Provider: ${c.lpurple(serverUrl)}`);

    const { detectProvider, configure, testConnection } = await import("./lib/providers/config");
    const providerConfig = detectProvider({ provider: "custom", apiKey: "local", baseURL: serverUrl, model: "local-fast" });
    configure(providerConfig);

    step("Testing connection...");
    const result = await testConnection();
    if (result.ok) {
      stepDone();
    } else {
      stepFail(result.error);
      error("Run 'contextador setup' to configure your AI provider.");
      process.exit(1);
    }

    heading("Generating CONTEXT.md");
    const { generateContextContent } = await import("./lib/core/generator");
    const { detectNewScopes } = await import("./lib/core/janitor");

    const scopes = await detectNewScopes(root, projectConfig.scanDepth);
    let generated = 0;
    for (const scope of scopes) {
      const contextPath = join(root, scope, "CONTEXT.md");
      if (await fileExists(contextPath)) continue;
      step(c.gray(scope));
      try {
        const content = await generateContextContent(root, scope);
        await mkdir(join(root, scope), { recursive: true });
        await writeFile(contextPath, content, "utf-8");
        stepDone();
        generated++;
      } catch (err: any) {
        stepFail(err.message);
      }
    }

    const rootContext = join(root, "CONTEXT.md");
    if (!await fileExists(rootContext)) {
      step(c.gray("(root)"));
      try {
        const content = await generateContextContent(root, ".");
        await writeFile(rootContext, content, "utf-8");
        stepDone();
        generated++;
      } catch (err: any) {
        stepFail(err.message);
      }
    }

    console.log("");
    success(`Generated ${c.bold(String(generated))} CONTEXT.md files`);
  } else {
    heading("Scaffold");
    info("No AI generation — use " + c.lpurple("contextador init -local") + " or Claude Code");
  }

  heading("Finalizing");
  step("Building hierarchy...");
  try {
    const hierarchyConfig = await buildHierarchyConfig(root);
    await writeFile(join(ctxDir, "hierarchy.json"), JSON.stringify(hierarchyConfig, null, 2), "utf-8");
    stepDone();
  } catch { stepFail(); }

  step("Generating briefing...");
  try {
    const briefing = await generateBriefing(root);
    await writeFile(join(ctxDir, "briefing.md"), briefing, "utf-8");
    stepDone();
  } catch { stepFail(); }

  await saveConfig(root, projectConfig);
  await writeFile(join(ctxDir, "janitor-state.json"), JSON.stringify({ lastRun: new Date().toISOString(), stages: {}, changed: false }, null, 2), "utf-8");

  const mcpPath = join(root, ".mcp.json");
  if (!await fileExists(mcpPath)) {
    await writeFile(mcpPath, JSON.stringify({ mcpServers: { contextador: { command: "bunx", args: ["contextador-mcp"] } } }, null, 2) + "\n", "utf-8");
    success("Created .mcp.json");
  }

  divider();
  success("Initialized. Your codebase is mapped.");
  console.log("");
}

async function cmdSweep() {
  banner();
  const { loadConfig } = await import("./lib/core/projectconfig");
  const { runJanitor } = await import("./lib/core/janitor");

  const config = await loadConfig(root);
  let bridge: any = null;

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
        warn("Another agent holds the janitor lock. Skipping sweep.");
        bridge.disconnect();
        return;
      }
    }
  }

  heading("Janitor Sweep");

  step("Running...");
  const state = await runJanitor(root);
  stepDone();

  if (bridge) {
    try { await bridge.releaseJanitorLock(); await bridge.summarizeRoom(); } catch {}
    bridge.disconnect();
  }

  const { stages } = state;
  for (const [name, result] of Object.entries(stages)) {
    const r = result as { processed: number; actions: string[] };
    if (r.processed > 0) {
      info(`${c.bold(name)}: ${c.purple(String(r.processed))} actions`);
      for (const action of r.actions.slice(0, 5)) {
        console.log(`      ${c.gray(action)}`);
      }
      if (r.actions.length > 5) console.log(`      ${c.dim(`… and ${r.actions.length - 5} more`)}`);
    }
  }

  divider();
  if (state.changed) {
    success("Sweep complete — artifacts updated.");
  } else {
    success("Sweep complete — everything fresh.");
  }
  console.log("");
}

async function cmdStatus() {
  banner();
  const { findContextFiles } = await import("./lib/core/hierarchy");
  const { checkFreshness } = await import("./lib/core/freshness");
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

  // Count freshness
  let fresh = 0, staleMinor = 0, staleMajor = 0;
  for (const file of contextFiles) {
    const f = await checkFreshness(root, file);
    if (f.fresh) fresh++;
    else if (f.staleSeverity === "major") staleMajor++;
    else staleMinor++;
  }

  heading("Project Status");
  stat("CONTEXT.md files", contextFiles.length, "purple");
  stat("Fresh", fresh, "green");
  if (staleMinor > 0) stat("Stale (minor)", staleMinor, "yellow");
  if (staleMajor > 0) stat("Stale (major)", staleMajor, "red");

  divider();
  stat("Provider", `${provider.provider}${provider.model ? ` (${provider.model})` : ""}`);
  stat("Project config", await fileExists(PROJECT_CONFIG_PATH) ? c.green("yes") : c.gray("no"));
  stat("Global config", await fileExists(GLOBAL_CONFIG_PATH) ? c.green("yes") : c.gray("no"));

  divider();
  if (projectConfig.mainframe.enabled) {
    stat("Mainframe", c.green("enabled"));
    stat("Operator", projectConfig.mainframe.operatorUrl);
    try {
      const res = await fetch(`${projectConfig.mainframe.operatorUrl}/_matrix/client/versions`, { signal: AbortSignal.timeout(3000) });
      stat("Connection", res.ok ? c.green("✓ reachable") : c.red(`✗ HTTP ${res.status}`));
    } catch {
      stat("Connection", c.red("✗ unreachable"));
    }
  } else {
    stat("Mainframe", c.gray("disabled"));
  }

  try {
    const raw = await readFile(join(root, ".contextador", "janitor-state.json"), "utf-8");
    const state = JSON.parse(raw);
    stat("Last sweep", c.gray(state.lastRun));
  } catch {
    stat("Last sweep", c.gray("never"));
  }

  console.log("");
}

async function cmdQuery() {
  const query = args.slice(1).filter(a => !a.startsWith("-")).join(" ");
  if (!query) {
    error("Usage: contextador query <question>");
    process.exit(1);
  }

  banner();
  const { routeQuery } = await import("./lib/core/headmaster");

  heading("Query");
  console.log(`  ${c.gray('"')}${c.white(query)}${c.gray('"')}\n`);

  const result = await routeQuery(root, query);

  stat("Routed to", c.lpurple(`${result.targetRole}:${result.targetScope}`));
  stat("Fan out", result.fanOut ? c.yellow("yes") : c.gray("no"));
  console.log("");
  info(`Targets (${c.bold(String(result.targets.length))}):`);
  for (const target of result.targets) {
    console.log(`      ${c.purple("→")} ${c.white(target.scope)}`);
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

  heading("Project Configuration");
  console.log(`  ${c.gray("Press Enter to keep current value.")}\n`);

  const modelUrl = await ask(`  ${c.purple("›")} Model server URL ${c.gray(`[${config.modelServerUrl}]`)}: `);
  if (modelUrl.trim()) config.modelServerUrl = modelUrl.trim();

  const minFiles = await ask(`  ${c.purple("›")} Min files threshold ${c.gray(`[${config.minFiles}]`)}: `);
  if (minFiles.trim()) config.minFiles = parseInt(minFiles.trim(), 10) || config.minFiles;

  const scanDepth = await ask(`  ${c.purple("›")} Scan depth ${c.gray(`[${config.scanDepth}]`)}: `);
  if (scanDepth.trim()) config.scanDepth = parseInt(scanDepth.trim(), 10) || config.scanDepth;

  const staleCommits = await ask(`  ${c.purple("›")} Stale commit threshold ${c.gray(`[${config.staleCommitThreshold}]`)}: `);
  if (staleCommits.trim()) config.staleCommitThreshold = parseInt(staleCommits.trim(), 10) || config.staleCommitThreshold;

  const staleDays = await ask(`  ${c.purple("›")} Stale days threshold ${c.gray(`[${config.staleDaysThreshold}]`)}: `);
  if (staleDays.trim()) config.staleDaysThreshold = parseInt(staleDays.trim(), 10) || config.staleDaysThreshold;

  heading("Mainframe");

  const mfEnabled = await ask(`  ${c.purple("›")} Mainframe enabled ${c.gray(`[${config.mainframe.enabled}]`)}: `);
  if (mfEnabled.trim()) config.mainframe.enabled = ["true", "yes"].includes(mfEnabled.trim().toLowerCase());

  if (config.mainframe.enabled) {
    const mfUrl = await ask(`  ${c.purple("›")} Operator URL ${c.gray(`[${config.mainframe.operatorUrl}]`)}: `);
    if (mfUrl.trim()) config.mainframe.operatorUrl = mfUrl.trim();

    const mfRoom = await ask(`  ${c.purple("›")} Project room ${c.gray(`[${config.mainframe.projectRoom}]`)}: `);
    if (mfRoom.trim()) config.mainframe.projectRoom = mfRoom.trim();

    const mfBudget = await ask(`  ${c.purple("›")} Daily token limit ${c.gray(`[${config.mainframe.dailyTokenLimit}]`)}: `);
    if (mfBudget.trim()) config.mainframe.dailyTokenLimit = parseInt(mfBudget.trim(), 10) || config.mainframe.dailyTokenLimit;
  }

  rl.close();
  await saveConfig(root, config);

  divider();
  success(`Saved to ${c.gray(PROJECT_CONFIG_PATH)}`);
  console.log("");
}

async function cmdDemolish() {
  banner();
  const { demolish } = await import("./lib/core/demolish");

  heading("Demolish");

  const result = await demolish(root);

  if (result.contextadorDirRemoved) success("Removed .contextador/");

  if (result.contextFilesRemoved.length > 0) {
    info(`Removed ${c.bold(String(result.contextFilesRemoved.length))} CONTEXT.md files:`);
    for (const file of result.contextFilesRemoved.slice(0, 20)) {
      console.log(`      ${c.red("−")} ${c.gray(file)}`);
    }
    if (result.contextFilesRemoved.length > 20) {
      console.log(`      ${c.dim(`… and ${result.contextFilesRemoved.length - 20} more`)}`);
    }
  } else {
    info("No CONTEXT.md files to remove.");
  }

  if (result.contextFilesKept.length > 0) {
    console.log("");
    info(`Kept ${c.bold(String(result.contextFilesKept.length))} user-created files:`);
    for (const file of result.contextFilesKept.slice(0, 10)) {
      console.log(`      ${c.green("◇")} ${c.gray(file)}`);
    }
  }

  if (result.mcpJsonUpdated) success("Cleaned .mcp.json");

  divider();
  success("Demolished. All contextador artifacts removed.");
  console.log("");
}

function cmdHelp() {
  banner();
  console.log(`  ${c.bold("Usage:")} contextador ${c.purple("<command>")} ${c.gray("[flags]")}\n`);

  console.log(`  ${c.bpurple("Commands:")}`);
  console.log(`    ${c.bold("setup")}        ${c.gray("Interactive first-time setup wizard")}`);
  console.log(`    ${c.bold("init")}         ${c.gray("Initialize contextador in the current project")}`);
  console.log(`      ${c.purple("-local")}     ${c.gray("Use local AI provider to generate CONTEXT.md files")}`);
  console.log(`    ${c.bold("sweep")}        ${c.gray("Run the janitor: refresh stale files, sync docs")}`);
  console.log(`    ${c.bold("status")}       ${c.gray("Show CONTEXT.md counts, provider, mainframe status")}`);
  console.log(`    ${c.bold("query")} ${c.purple("<q>")}    ${c.gray("Route a query and show matching scopes")}`);
  console.log(`    ${c.bold("configure")}    ${c.gray("Interactive project config editor")}`);
  console.log(`    ${c.bold("demolish")}     ${c.gray("Remove all contextador artifacts from the project")}`);
  console.log(`    ${c.bold("help")}         ${c.gray("Show this help message")}`);
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
    error(`Unknown command: ${command}`);
    console.error(`  Run ${c.purple("contextador help")} for usage.`);
    process.exit(1);
}
