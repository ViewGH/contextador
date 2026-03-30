import { mkdir, writeFile, readFile } from "fs/promises";
import { join, resolve } from "path";
import readline from "readline";

const CONFIG_DIR = join(process.env.HOME ?? "~", ".contextador");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

interface GlobalConfig {
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
  mainframe: {
    enabled: boolean;
    operatorUrl: string;
    serverName: string;
    autoSetup: boolean;
  };
}

function createRL(): { ask: (q: string) => Promise<string>; close: () => void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (q: string) => new Promise((resolve) => rl.question(q, resolve)),
    close: () => rl.close(),
  };
}

function banner() {
  console.log("");
  console.log("  ◆ Contextador — by View AI");
  console.log("  Codebase context system for AI agents");
  console.log("");
}

async function selectProvider(
  ask: (q: string) => Promise<string>,
): Promise<{ provider: string; apiKey: string; baseURL: string; model: string }> {
  console.log("  ─── AI Provider ───\n");
  console.log("  Select your AI provider:");
  console.log("  1) Anthropic (Claude)");
  console.log("  2) OpenAI (GPT)");
  console.log("  3) Google (Gemini)");
  console.log("  4) GitHub Copilot");
  console.log("  5) OpenRouter (100+ models)");
  console.log("  6) Custom server (Ollama, LM Studio, etc.)");
  console.log("  7) Claude Code (no API key needed)");
  console.log("");

  const choice = await ask("  > ");

  const providers: Record<
    string,
    { provider: string; needsKey: boolean; keyName: string; needsURL: boolean }
  > = {
    "1": { provider: "anthropic", needsKey: true, keyName: "Anthropic API Key", needsURL: false },
    "2": { provider: "openai", needsKey: true, keyName: "OpenAI API Key", needsURL: false },
    "3": { provider: "google", needsKey: true, keyName: "Google API Key", needsURL: false },
    "4": {
      provider: "copilot",
      needsKey: true,
      keyName: "GitHub Token (with Copilot access)",
      needsURL: false,
    },
    "5": { provider: "openrouter", needsKey: true, keyName: "OpenRouter API Key", needsURL: false },
    "6": {
      provider: "custom",
      needsKey: true,
      keyName: "API Key (or press Enter for none)",
      needsURL: true,
    },
    "7": { provider: "claude-code", needsKey: false, keyName: "", needsURL: false },
  };

  const selected = providers[choice.trim()] ?? providers["7"];
  let apiKey = "";
  let baseURL = "";
  let model = "";

  if (selected.needsKey) {
    apiKey = await ask(`  ${selected.keyName}: `);
  }

  if (selected.needsURL) {
    baseURL = await ask("  Server URL [http://127.0.0.1:8089/v1]: ");
    if (!baseURL.trim()) baseURL = "http://127.0.0.1:8089/v1";
    model = await ask("  Model name [default]: ");
    if (!model.trim()) model = "default";
  }

  // Test connection for providers that need an API key
  if (selected.provider !== "claude-code") {
    process.stdout.write("  Testing connection... ");
    try {
      const { detectProvider, configure, testConnection } = await import("../providers/config");
      const config = detectProvider({
        provider: selected.provider as any,
        apiKey,
        baseURL,
        model,
      });
      configure(config);
      const result = await testConnection();
      if (result.ok) {
        console.log(`✓ Connected (${config.model})`);
      } else {
        console.log(`✗ ${result.error}`);
        console.log(
          "  Continuing anyway — you can fix this later with 'contextador setup'",
        );
      }
    } catch (err: any) {
      console.log(`✗ ${err.message}`);
      console.log("  Continuing anyway — you can fix this later with 'contextador setup'");
    }
  } else {
    console.log("  ✓ Claude Code selected — no API key needed");
  }

  console.log("");
  return {
    provider: selected.provider,
    apiKey: apiKey.trim(),
    baseURL: baseURL.trim(),
    model: model.trim(),
  };
}

async function setupMainframe(
  ask: (q: string) => Promise<string>,
): Promise<GlobalConfig["mainframe"]> {
  console.log("  ─── Mainframe (Multi-Agent Sharing) ───\n");
  console.log("  Enable Mainframe? Agents on different machines share");
  console.log("  context discoveries, saving tokens on repeat queries.\n");

  const enable = await ask("  Enable Mainframe? (yes/no) [no]: ");
  const wantsMainframe =
    enable.trim().toLowerCase() === "yes" || enable.trim().toLowerCase() === "y";

  if (!wantsMainframe) {
    console.log("  Mainframe disabled.\n");
    return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
  }

  console.log("");
  console.log("  Do you have an existing Matrix server?");
  console.log("  1) No, set one up for me (requires Docker)");
  console.log("  2) Yes, I'll provide the URL");
  console.log("");

  const serverChoice = await ask("  > ");

  if (serverChoice.trim() === "2") {
    return await setupExistingServer(ask);
  }

  return await setupDockerOperator();
}

async function setupExistingServer(
  ask: (q: string) => Promise<string>,
): Promise<GlobalConfig["mainframe"]> {
  const url = await ask("  Matrix server URL: ");
  const serverName = await ask("  Server name: ");
  console.log("");
  process.stdout.write("  Testing connection... ");

  try {
    const res = await fetch(`${url.trim()}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      console.log("✓ Connected");
    } else {
      console.log(`✗ HTTP ${res.status}`);
      console.log("  Continuing anyway — you can fix this later with 'contextador setup'");
    }
  } catch {
    console.log("✗ Could not reach server");
    console.log("  Continuing anyway — you can fix this later with 'contextador setup'");
  }

  console.log("");
  return {
    enabled: true,
    operatorUrl: url.trim(),
    serverName: serverName.trim(),
    autoSetup: false,
  };
}

async function setupDockerOperator(): Promise<GlobalConfig["mainframe"]> {
  process.stdout.write("  Checking Docker... ");

  try {
    const proc = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    if (proc.exitCode !== 0) {
      console.log("✗ Docker not running");
      console.log(
        "  Please install and start Docker, then run 'contextador setup' again.",
      );
      console.log("  Or choose option 2 to use an existing Matrix server.\n");
      return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
    }
    console.log("✓ Docker found");
  } catch {
    console.log("✗ Docker not found");
    console.log("  Install Docker: https://docs.docker.com/get-docker/");
    console.log("  Then run 'contextador setup' again.\n");
    return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
  }

  // Start Operator via Docker Compose
  console.log("  Starting Operator...");

  try {
    const dockerDir = resolve(import.meta.dir, "../../docker");

    // Generate config from template
    const templatePath = join(dockerDir, "conduwuit.toml");
    const template = await readFile(templatePath, "utf-8");
    const config = template.replace("{{SERVER_NAME}}", "contextador.local");
    await writeFile(join(dockerDir, "conduwuit.generated.toml"), config);

    const composePath = join(dockerDir, "docker-compose.yml");
    const proc = Bun.spawn(["docker", "compose", "-f", composePath, "up", "-d"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, OPERATOR_PORT: "6167" },
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.log(`  ✗ Docker compose failed: ${stderr.slice(0, 200)}\n`);
      return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
    }

    // Wait for the server to become healthy
    let healthy = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await fetch("http://localhost:6167/_matrix/client/versions", {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (healthy) {
      console.log("  ✓ Operator running at localhost:6167");
      console.log("  ✓ Server name: contextador.local\n");
      return {
        enabled: true,
        operatorUrl: "http://localhost:6167",
        serverName: "contextador.local",
        autoSetup: true,
      };
    }

    console.log(
      "  ✗ Operator started but not responding. Check: docker logs contextador-operator\n",
    );
    return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
  } catch (err: any) {
    console.log(`  ✗ Error: ${err.message}\n`);
    return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
  }
}

export async function runSetup(): Promise<void> {
  banner();

  const { ask, close } = createRL();

  try {
    const providerConfig = await selectProvider(ask);
    const mainframeConfig = await setupMainframe(ask);

    // Save config
    await mkdir(CONFIG_DIR, { recursive: true });
    const config: GlobalConfig = {
      ...providerConfig,
      mainframe: mainframeConfig,
    };
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");

    console.log("  ─── Done ───\n");
    console.log(`  ✓ Configuration saved to ${CONFIG_PATH}`);
    console.log("");
    console.log("  Next: run 'contextador init' in any project to get started.");
    console.log("");
  } finally {
    close();
  }
}

export async function loadGlobalConfig(): Promise<GlobalConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
