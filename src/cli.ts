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

  // Generate framework-specific config
  if (globalConfig?.framework === "openclaw") {
    const { generateOpenClawSkill } = await import("./lib/frameworks/openclaw");
    const skillDir = join(root, "skills", "contextador");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), generateOpenClawSkill(), "utf-8");
    success("Created OpenClaw skill: skills/contextador/SKILL.md");
  } else if (globalConfig?.framework === "hermes") {
    const { generateHermesToolGuide } = await import("./lib/frameworks/hermes");
    await writeFile(join(root, "CONTEXTADOR_HERMES.md"), generateHermesToolGuide(), "utf-8");
    success("Created Hermes guide: CONTEXTADOR_HERMES.md");
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

async function cmdWebhook() {
  const subCmd = args[1];

  if (subCmd === "start") {
    banner();
    const { startWebhookServer } = await import("./lib/github/webhook");
    const { loadConfig } = await import("./lib/core/projectconfig");

    const config = await loadConfig(root);

    // Allow port override via --port flag
    const portFlag = args.find(a => a.startsWith("--port="));
    const portOverride = portFlag ? parseInt(portFlag.split("=")[1], 10) : undefined;

    // Allow secret override via --secret flag
    const secretFlag = args.find(a => a.startsWith("--secret="));
    const secretOverride = secretFlag ? secretFlag.split("=")[1] : undefined;

    // Allow --no-verify to skip signature verification
    const noVerify = args.includes("--no-verify");

    const overrides: Record<string, any> = {};
    if (portOverride) overrides.port = portOverride;
    if (secretOverride) overrides.secret = secretOverride;

    heading("Webhook Server");

    const { server, port } = await startWebhookServer(root, overrides, { noVerify });

    success(`Listening on port ${c.bold(String(port))}`);
    info(`Health check: ${c.lpurple(`http://localhost:${port}/health`)}`);
    info(`Webhook URL:  ${c.lpurple(`http://localhost:${port}/webhook`)}`);
    console.log("");
    info(`Watching branches: ${c.white(config.webhook?.branches?.join(", ") || "main, master")}`);
    if (config.webhook?.secret || secretOverride) {
      info(`HMAC verification: ${c.green("enabled")}`);
    } else {
      warn("No webhook secret configured — anyone can trigger sweeps.");
      info(`Set one with: ${c.purple("contextador webhook start --secret=<your-secret>")}`);
    }
    console.log("");
    info(`${c.gray("Press Ctrl+C to stop")}`);

    // Keep alive
    await new Promise(() => {});
  } else if (subCmd === "events") {
    banner();
    const { getWebhookEvents } = await import("./lib/github/webhook");

    const limit = parseInt(args[2] || "10", 10);
    const events = await getWebhookEvents(root, limit);

    heading("Recent Webhook Events");

    if (events.length === 0) {
      info("No events recorded yet.");
    } else {
      for (const event of events) {
        const status = event.swept ? c.green("swept") : c.gray("skipped");
        const scopes = event.triage.affectedScopes.length > 0
          ? ` → ${event.triage.affectedScopes.join(", ")}`
          : "";
        console.log(`  ${c.gray(event.receivedAt.slice(0, 19))} ${c.white(event.branch)} ${c.purple(`+${event.commits}`)} ${status}${scopes}`);
        console.log(`    ${c.gray(event.triage.reason)}`);
      }
    }
    console.log("");
  } else if (subCmd === "test") {
    banner();
    const { triagePush } = await import("./lib/github/triage");
    const { loadConfig } = await import("./lib/core/projectconfig");

    heading("Triage Test");
    info("Simulating a push event from recent git history...");

    // Get last 2 commits to simulate a push
    const proc = Bun.spawn(["git", "log", "-2", "--format=%H", "--no-merges"], {
      cwd: root, stdout: "pipe", stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const shas = output.trim().split("\n");

    if (shas.length < 2) {
      error("Need at least 2 commits to simulate a push.");
      process.exit(1);
    }

    const afterSha = shas[0];
    const beforeSha = shas[1];

    // Get changed files between the two commits
    const diffProc = Bun.spawn(
      ["git", "diff", "--name-status", `${beforeSha}...${afterSha}`],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const diffOutput = await new Response(diffProc.stdout).text();
    await diffProc.exited;

    const commits = [{
      id: afterSha,
      message: "",
      timestamp: new Date().toISOString(),
      added: [] as string[],
      modified: [] as string[],
      removed: [] as string[],
    }];

    for (const line of diffOutput.trim().split("\n")) {
      const [status, ...fileParts] = line.split("\t");
      const file = fileParts.join("\t");
      if (!file) continue;
      if (status === "A") commits[0].added.push(file);
      else if (status === "D") commits[0].removed.push(file);
      else commits[0].modified.push(file);
    }

    const payload = {
      ref: "refs/heads/main",
      before: beforeSha,
      after: afterSha,
      repository: { full_name: "test/test", name: "test", default_branch: "main" },
      commits,
      head_commit: commits[0],
      pusher: { name: "test", email: "test@test.com" },
      forced: false,
    };

    step("Triaging...");
    const result = await triagePush(root, payload);
    stepDone();

    console.log("");
    stat("Should update", result.shouldUpdate ? c.green("YES") : c.gray("NO"));
    stat("Files changed", result.filesChanged);
    stat("Lines changed", result.linesChanged);
    stat("Affected scopes", result.affectedScopes.length > 0 ? result.affectedScopes.join(", ") : "(none)");
    console.log("");
    info(`Reason: ${c.white(result.reason)}`);
    console.log("");
  } else {
    banner();
    heading("Webhook Commands");
    console.log(`  ${c.bold("contextador webhook start")}    ${c.gray("Start the webhook listener")}`);
    console.log(`    ${c.purple("--port=9471")}                ${c.gray("Override listen port")}`);
    console.log(`    ${c.purple("--secret=<s>")}               ${c.gray("Set HMAC verification secret")}`);
    console.log(`  ${c.bold("contextador webhook events")}   ${c.gray("Show recent webhook events")}`);
    console.log(`  ${c.bold("contextador webhook test")}     ${c.gray("Simulate a push with recent commits")}`);
    console.log("");
  }
}

async function cmdStats() {
  banner();
  const { loadStats, estimateTokensSaved } = await import("./lib/core/stats");
  const { findContextFiles } = await import("./lib/core/hierarchy");

  const stats = await loadStats(root);
  const contextFiles = await findContextFiles(root);
  const est = estimateTokensSaved(stats);
  const cacheRate = stats.queriesServed > 0 ? Math.round((stats.cacheHits / stats.queriesServed) * 100) : 0;

  heading("Usage Stats");

  stat("Queries served", stats.queriesServed, "purple");
  stat("Cache hits (Mainframe)", `${stats.cacheHits}${stats.queriesServed > 0 ? `  (${cacheRate}%)` : ""}`, "green");
  stat("Feedback reports", stats.feedbackReports);
  stat("Sweeps run", stats.sweepsRun);

  divider();

  stat("Tokens saved (est.)", `~${est.saved.toLocaleString()}`, "green");
  stat("Tokens used (init)", `~${stats.tokensUsedInit.toLocaleString()}`);
  stat("Tokens used (queries)", `~${stats.tokensUsedQueries.toLocaleString()}`);
  stat("Net savings", `~${est.net.toLocaleString()}`, est.net > 0 ? "green" : "red");

  divider();

  stat("CONTEXT.md files", contextFiles.length, "purple");
  if (stats.firstUsed) stat("First used", stats.firstUsed.slice(0, 10));
  if (stats.lastUsed) stat("Last used", stats.lastUsed.slice(0, 10));
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
  console.log(`    ${c.bold("stats")}        ${c.gray("Show usage statistics and token savings")}`);
  console.log(`    ${c.bold("configure")}    ${c.gray("Interactive project config editor")}`);
  console.log(`    ${c.bold("webhook")}      ${c.gray("GitHub push webhook — auto-update context on push")}`);
  console.log(`    ${c.bold("update")}       ${c.gray("Check for and install the latest version")}`);
  console.log(`    ${c.bold("doctor")}       ${c.gray("Diagnose setup issues and check system health")}`);
  console.log(`    ${c.bold("demolish")}     ${c.gray("Remove all contextador artifacts from the project")}`);
  console.log(`    ${c.bold("help")}         ${c.gray("Show this help message")}`);
  console.log("");
}

async function cmdUpdate() {
  banner();
  heading("Update");

  step("Checking current version...");
  const pkg = await import("../package.json");
  const currentVersion = pkg.version ?? "unknown";
  stepDone();
  info(`Current: ${c.lpurple(currentVersion)}`);

  step("Checking for updates...");
  try {
    const proc = Bun.spawn(["npm", "view", "contextador", "version", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const latestVersion = JSON.parse(output.trim());
    stepDone();
    info(`Latest:  ${c.lpurple(latestVersion)}`);

    if (currentVersion === latestVersion) {
      console.log("");
      success("Already on the latest version.");
      console.log("");
      return;
    }

    console.log("");
    step(`Updating to ${c.bold(latestVersion)}...`);
    const updateProc = Bun.spawn(["bun", "install", "-g", `contextador@${latestVersion}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await updateProc.exited;

    if (updateProc.exitCode === 0) {
      stepDone();
      divider();
      success(`Updated to ${c.lpurple(latestVersion)}`);
    } else {
      stepFail();
      const stderr = await new Response(updateProc.stderr).text();
      error(stderr.slice(0, 200));
      info("Try manually: " + c.purple(`bun install -g contextador@${latestVersion}`));
    }
  } catch (err: any) {
    stepFail(err.message);
    info("Try manually: " + c.purple("bun install -g contextador@latest"));
  }
  console.log("");
}

async function cmdDoctor() {
  banner();
  heading("Doctor");

  let passed = 0;
  let warnings = 0;
  let failed = 0;
  const tips: string[] = [];

  // 1. Bun version
  try {
    success(`Bun v${Bun.version}`);
    passed++;
  } catch {
    warn("Could not detect Bun version");
    warnings++;
  }

  // 2. Global config
  if (await fileExists(GLOBAL_CONFIG_PATH)) {
    success("Global config found");
    passed++;
  } else {
    error("Global config missing");
    tips.push("Run " + c.purple("contextador setup") + " to create global config.");
    failed++;
  }

  // 3. Project config
  if (await fileExists(join(root, ".contextador", "config.json"))) {
    success("Project config found");
    passed++;
  } else {
    warn("Project not initialized in this directory");
    tips.push("Run " + c.purple("contextador init") + " in your project.");
    warnings++;
  }

  // 4. AI Provider
  try {
    const { loadGlobalConfig } = await import("./lib/setup/wizard");
    const globalConfig = await loadGlobalConfig();
    if (globalConfig?.provider) {
      const { detectProvider, configure, testConnection } = await import("./lib/providers/config");
      const providerConfig = detectProvider({
        provider: globalConfig.provider as any,
        apiKey: globalConfig.apiKey ?? "",
        baseURL: globalConfig.baseURL ?? "",
        model: globalConfig.model ?? "",
      });

      if (providerConfig.provider === "claude-code") {
        success(`AI Provider: ${c.lpurple("Claude Code")} ${c.gray("(no API key needed)")}`);
        passed++;
      } else {
        configure(providerConfig);
        const result = await testConnection();
        if (result.ok) {
          success(`AI Provider: ${c.lpurple(providerConfig.provider)} ${c.gray(`(${providerConfig.model})`)} — reachable`);
          passed++;
        } else {
          warn(`AI Provider: ${providerConfig.provider} — ${c.red("unreachable")}: ${result.error}`);
          tips.push("Check your API key or server URL. Run " + c.purple("contextador setup") + " to reconfigure.");
          warnings++;
        }
      }
    } else {
      warn("No AI provider configured");
      tips.push("Run " + c.purple("contextador setup") + " to set up an AI provider.");
      warnings++;
    }
  } catch {
    warn("Could not check AI provider");
    warnings++;
  }

  // 5. CONTEXT.md files
  try {
    const { findContextFiles } = await import("./lib/core/hierarchy");
    const { checkFreshness } = await import("./lib/core/freshness");
    const files = await findContextFiles(root);
    if (files.length > 0) {
      let fresh = 0, stale = 0;
      for (const f of files) {
        const check = await checkFreshness(root, f);
        if (check.fresh) fresh++;
        else stale++;
      }
      if (stale > 0) {
        warn(`CONTEXT.md files: ${files.length} (${c.green(String(fresh))} fresh, ${c.yellow(String(stale))} stale)`);
        tips.push("Run " + c.purple("contextador sweep") + " to refresh stale files.");
        warnings++;
      } else {
        success(`CONTEXT.md files: ${c.lpurple(String(files.length))} (all fresh)`);
        passed++;
      }
    } else {
      warn("No CONTEXT.md files found");
      tips.push("Run " + c.purple("contextador init -local") + " to generate them.");
      warnings++;
    }
  } catch {
    warn("Could not scan CONTEXT.md files");
    warnings++;
  }

  // 6. .mcp.json
  if (await fileExists(join(root, ".mcp.json"))) {
    success(".mcp.json found");
    passed++;
  } else {
    warn(".mcp.json missing — MCP editors won't auto-detect contextador");
    tips.push("Run " + c.purple("contextador init") + " to create .mcp.json.");
    warnings++;
  }

  // 7. Framework
  try {
    const { loadGlobalConfig } = await import("./lib/setup/wizard");
    const globalConfig = await loadGlobalConfig();
    const fw = globalConfig?.framework ?? "not set";
    const labels: Record<string, string> = {
      "claude-code": "Claude Code / Cursor",
      "openclaw": "OpenClaw",
      "hermes": "Hermes (Nous Research)",
      "other": "Other",
    };
    success(`Framework: ${c.lpurple(labels[fw] ?? fw)}`);
    passed++;
  } catch {
    warn("Could not detect framework");
    warnings++;
  }

  // 8. Mainframe
  try {
    const { loadConfig } = await import("./lib/core/projectconfig");
    const config = await loadConfig(root);
    if (config.mainframe?.enabled) {
      success(`Mainframe: ${c.green("enabled")}`);
      passed++;

      // Check Docker
      try {
        const proc = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" });
        await proc.exited;
        if (proc.exitCode === 0) {
          success("Docker: running");
          passed++;
        } else {
          error("Docker: not running");
          tips.push("Start Docker Desktop to use Mainframe.");
          failed++;
        }
      } catch {
        error("Docker: not found");
        tips.push("Install Docker: https://docs.docker.com/get-docker/");
        failed++;
      }

      // Check Operator
      try {
        const res = await fetch(`${config.mainframe.operatorUrl}/_matrix/client/versions`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          success(`Operator: responding at ${c.lpurple(config.mainframe.operatorUrl)}`);
          passed++;
        } else {
          error(`Operator: HTTP ${res.status}`);
          tips.push("Restart Operator: " + c.gray("docker restart contextador-operator"));
          failed++;
        }
      } catch {
        error("Operator: unreachable");
        tips.push("Start Operator: " + c.purple("contextador setup") + " (say yes to Mainframe)");
        failed++;
      }
    } else {
      info(`Mainframe: ${c.gray("disabled")}`);
      passed++;
    }
  } catch {
    warn("Could not check Mainframe status");
    warnings++;
  }

  // 9. Repair queue
  try {
    const raw = await readFile(join(root, ".contextador", "repair-queue.json"), "utf-8");
    const queue = JSON.parse(raw);
    if (Array.isArray(queue) && queue.length > 0) {
      warn(`Repair queue: ${c.yellow(String(queue.length))} pending items`);
      tips.push("Run " + c.purple("contextador sweep") + " to process the repair queue.");
      warnings++;
    } else {
      success("Repair queue: empty");
      passed++;
    }
  } catch {
    success("Repair queue: empty");
    passed++;
  }

  // 10. Stats summary
  try {
    const { loadStats, estimateTokensSaved } = await import("./lib/core/stats");
    const stats = await loadStats(root);
    if (stats.queriesServed > 0) {
      const est = estimateTokensSaved(stats);
      success(`Token savings: ${c.green(`~${est.net.toLocaleString()}`)} net (${stats.queriesServed} queries)`);
      passed++;
    } else {
      info("No queries recorded yet");
      passed++;
    }
  } catch {
    info("No stats available");
    passed++;
  }

  // Summary
  divider();
  const total = passed + warnings + failed;
  const parts: string[] = [];
  if (passed > 0) parts.push(c.green(`${passed} passed`));
  if (warnings > 0) parts.push(c.yellow(`${warnings} warning${warnings > 1 ? "s" : ""}`));
  if (failed > 0) parts.push(c.red(`${failed} failed`));
  console.log(`  ${parts.join(", ")}`);

  if (tips.length > 0) {
    console.log("");
    for (const tip of tips) {
      info(tip);
    }
  }

  if (failed === 0 && warnings === 0) {
    console.log("");
    success("Everything looks good!");
  }

  console.log("");
}

function cmdCredits() {
  console.log("");
  console.log(c.purple("  ╔══════════════════════════════════════════╗"));
  console.log(c.purple("  ║") + "                                          " + c.purple("║"));
  console.log(c.purple("  ║") + c.bpurple("        ✦  C O N T E X T A D O R  ✦       ") + c.purple("║"));
  console.log(c.purple("  ║") + "                                          " + c.purple("║"));
  console.log(c.purple("  ║") + "                                          " + c.purple("║"));
  console.log(c.purple("  ║") + `        Created by: ${c.bold("Will Ott")}              ` + c.purple("║"));
  console.log(c.purple("  ║") + "                                          " + c.purple("║"));
  console.log(c.purple("  ║") + `     ${c.gray("\"The wizard sees all context.\"")}        ` + c.purple("║"));
  console.log(c.purple("  ║") + "                                          " + c.purple("║"));
  console.log(c.purple("  ║") + `           ${c.lpurple("◆")} ${c.gray("View AI")} ${c.lpurple("◆")}                   ` + c.purple("║"));
  console.log(c.purple("  ║") + "                                          " + c.purple("║"));
  console.log(c.purple("  ╚══════════════════════════════════════════╝"));
  console.log("");
}

// ── Dispatch ─────────────────────────────────────────────────────

switch (command) {
  case "setup":     await cmdSetup(); break;
  case "init":      await cmdInit(); break;
  case "sweep":     await cmdSweep(); break;
  case "status":    await cmdStatus(); break;
  case "query":     await cmdQuery(); break;
  case "stats":     await cmdStats(); break;
  case "configure": await cmdConfigure(); break;
  case "webhook":   await cmdWebhook(); break;
  case "update":    await cmdUpdate(); break;
  case "doctor":    await cmdDoctor(); break;
  case "demolish":  await cmdDemolish(); break;
  case "credits":   cmdCredits(); break;
  case "help":
  case "--help":
  case "-h":
  case undefined:   cmdHelp(); break;
  default:
    error(`Unknown command: ${command}`);
    console.error(`  Run ${c.purple("contextador help")} for usage.`);
    process.exit(1);
}
