import { mkdir, writeFile, readFile } from "fs/promises";
import { join, resolve } from "path";
import readline from "readline";
import { banner, heading, success, error, warn, info, step, stepDone, stepFail, divider, c } from "../ui";

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

async function selectProvider(
  ask: (q: string) => Promise<string>,
): Promise<{ provider: string; apiKey: string; baseURL: string; model: string }> {
  heading("AI Provider");

  console.log(`  ${c.bold("Select your AI provider:")}\n`);
  console.log(`  ${c.purple("1)")} ${c.white("Anthropic")} ${c.gray("(Claude)")}`);
  console.log(`  ${c.purple("2)")} ${c.white("OpenAI")} ${c.gray("(GPT)")}`);
  console.log(`  ${c.purple("3)")} ${c.white("Google")} ${c.gray("(Gemini)")}`);
  console.log(`  ${c.purple("4)")} ${c.white("GitHub Copilot")}`);
  console.log(`  ${c.purple("5)")} ${c.white("OpenRouter")} ${c.gray("(100+ models)")}`);
  console.log(`  ${c.purple("6)")} ${c.white("Custom server")} ${c.gray("(Ollama, LM Studio, etc.)")}`);
  console.log(`  ${c.purple("7)")} ${c.white("Claude Code")} ${c.gray("(no API key needed)")}`);
  console.log("");

  const choice = await ask(`  ${c.purple("›")} `);

  const providers: Record<
    string,
    { provider: string; needsKey: boolean; keyName: string; needsURL: boolean }
  > = {
    "1": { provider: "anthropic", needsKey: true, keyName: "Anthropic API Key", needsURL: false },
    "2": { provider: "openai", needsKey: true, keyName: "OpenAI API Key", needsURL: false },
    "3": { provider: "google", needsKey: true, keyName: "Google API Key", needsURL: false },
    "4": { provider: "copilot", needsKey: true, keyName: "GitHub Token (with Copilot access)", needsURL: false },
    "5": { provider: "openrouter", needsKey: true, keyName: "OpenRouter API Key", needsURL: false },
    "6": { provider: "custom", needsKey: true, keyName: "API Key (or press Enter for none)", needsURL: true },
    "7": { provider: "claude-code", needsKey: false, keyName: "", needsURL: false },
  };

  const selected = providers[choice.trim()] ?? providers["7"];
  let apiKey = "";
  let baseURL = "";
  let model = "";

  if (selected.needsKey) {
    apiKey = await ask(`  ${c.purple("›")} ${selected.keyName}: `);
  }

  if (selected.needsURL) {
    baseURL = await ask(`  ${c.purple("›")} Server URL ${c.gray("[http://127.0.0.1:8089/v1]")}: `);
    if (!baseURL.trim()) baseURL = "http://127.0.0.1:8089/v1";
    model = await ask(`  ${c.purple("›")} Model name ${c.gray("[default]")}: `);
    if (!model.trim()) model = "default";
  }

  console.log("");

  if (selected.provider !== "claude-code") {
    step("Testing connection...");
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
        stepDone();
        info(`Provider: ${c.lpurple(config.provider)} ${c.gray(`(${config.model})`)}`);
      } else {
        stepFail(result.error);
        warn("You can fix this later with " + c.purple("contextador setup"));
      }
    } catch (err: any) {
      stepFail(err.message);
      warn("You can fix this later with " + c.purple("contextador setup"));
    }
  } else {
    success("Claude Code selected — no API key needed");
    info("Contextador will use Claude Code as the AI via MCP tools");
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
  heading("Mainframe");

  console.log(`  ${c.bold("Multi-agent context sharing")}`);
  console.log(`  ${c.gray("Agents on different machines share discoveries,")}`);
  console.log(`  ${c.gray("saving tokens on repeat queries.")}\n`);

  const enable = await ask(`  ${c.purple("›")} Enable Mainframe? ${c.gray("(yes/no) [no]")}: `);
  const wantsMainframe =
    enable.trim().toLowerCase() === "yes" || enable.trim().toLowerCase() === "y";

  if (!wantsMainframe) {
    info("Mainframe disabled — single-agent mode.");
    console.log("");
    return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
  }

  console.log("");
  console.log(`  ${c.bold("Operator setup:")}`);
  console.log(`  ${c.purple("1)")} ${c.white("Set one up for me")} ${c.gray("(requires Docker)")}`);
  console.log(`  ${c.purple("2)")} ${c.white("I have an existing Matrix server")}`);
  console.log("");

  const serverChoice = await ask(`  ${c.purple("›")} `);

  if (serverChoice.trim() === "2") {
    return await setupExistingServer(ask);
  }

  return await setupDockerOperator();
}

async function setupExistingServer(
  ask: (q: string) => Promise<string>,
): Promise<GlobalConfig["mainframe"]> {
  const url = await ask(`  ${c.purple("›")} Matrix server URL: `);
  const serverName = await ask(`  ${c.purple("›")} Server name: `);
  console.log("");

  step("Testing connection...");
  try {
    const res = await fetch(`${url.trim()}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      stepDone();
    } else {
      stepFail(`HTTP ${res.status}`);
      warn("You can fix this later with " + c.purple("contextador setup"));
    }
  } catch {
    stepFail("Could not reach server");
    warn("You can fix this later with " + c.purple("contextador setup"));
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
  step("Checking Docker...");

  try {
    const proc = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    if (proc.exitCode !== 0) {
      stepFail("Docker not running");
      warn("Install and start Docker, then run " + c.purple("contextador setup") + " again.");
      info("Or choose option 2 to use an existing Matrix server.");
      console.log("");
      return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
    }
    stepDone();
  } catch {
    stepFail("Docker not found");
    info("Install Docker: " + c.lpurple("https://docs.docker.com/get-docker/"));
    info("Then run " + c.purple("contextador setup") + " again.");
    console.log("");
    return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
  }

  step("Starting Operator...");

  try {
    const dockerDir = resolve(import.meta.dir, "../../docker");

    const templatePath = join(dockerDir, "operator.toml");
    const template = await readFile(templatePath, "utf-8");
    const config = template.replace("{{SERVER_NAME}}", "contextador.local");
    await writeFile(join(dockerDir, "operator.generated.toml"), config);

    const composePath = join(dockerDir, "docker-compose.yml");
    const proc = Bun.spawn(["docker", "compose", "-f", composePath, "up", "-d"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, OPERATOR_PORT: "6167" },
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      stepFail(stderr.slice(0, 100));
      return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
    }

    // Wait for health
    let healthy = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await fetch("http://localhost:6167/_matrix/client/versions", {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) { healthy = true; break; }
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (healthy) {
      stepDone();
      success("Operator running at " + c.lpurple("localhost:6167"));
      success("Server name: " + c.lpurple("contextador.local"));
      console.log("");
      return {
        enabled: true,
        operatorUrl: "http://localhost:6167",
        serverName: "contextador.local",
        autoSetup: true,
      };
    }

    stepFail("Not responding");
    warn("Check logs: " + c.gray("docker logs contextador-operator"));
    console.log("");
    return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
  } catch (err: any) {
    stepFail(err.message);
    return { enabled: false, operatorUrl: "", serverName: "", autoSetup: false };
  }
}

export async function runSetup(): Promise<void> {
  banner();

  const { ask, close } = createRL();

  try {
    const providerConfig = await selectProvider(ask);
    const mainframeConfig = await setupMainframe(ask);

    await mkdir(CONFIG_DIR, { recursive: true });
    const config: GlobalConfig = {
      ...providerConfig,
      mainframe: mainframeConfig,
    };
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");

    divider();
    success(`Configuration saved to ${c.gray(CONFIG_PATH)}`);
    console.log("");
    info("Next: run " + c.purple("contextador init") + " in any project to get started.");
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
