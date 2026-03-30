import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

export interface MainframeSettings {
  enabled: boolean;
  operatorUrl: string;
  projectRoom: string;
  alertRoom: string;
  dailyTokenLimit: number;
}

export interface WebhookSettings {
  enabled: boolean;
  port: number;
  secret: string;
  branches: string[];
}

export interface ProjectConfig {
  modelServerUrl: string;
  minFiles: number;
  scanDepth: number;
  hitLogMaxEntries: number;
  hitLogMaxDays: number;
  staleCommitThreshold: number;
  staleDaysThreshold: number;
  mainframe: MainframeSettings;
  webhook: WebhookSettings;
}

const DEFAULTS: ProjectConfig = {
  modelServerUrl: "http://127.0.0.1:8089/v1",
  minFiles: 500,
  scanDepth: 6,
  hitLogMaxEntries: 50,
  hitLogMaxDays: 30,
  staleCommitThreshold: 3,
  staleDaysThreshold: 3,
  mainframe: {
    enabled: false,
    operatorUrl: "http://localhost:6167",
    projectRoom: "#ctx-default:localhost",
    alertRoom: "#ctx-alerts:localhost",
    dailyTokenLimit: 50000,
  },
  webhook: {
    enabled: false,
    port: 9471,
    secret: "",
    branches: ["main", "master"],
  },
};

export function getDefaults(): ProjectConfig {
  return { ...DEFAULTS };
}

export async function loadConfig(root: string): Promise<ProjectConfig> {
  try {
    const raw = await readFile(join(root, ".contextador", "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveConfig(root: string, config: ProjectConfig): Promise<void> {
  await mkdir(join(root, ".contextador"), { recursive: true });
  await writeFile(
    join(root, ".contextador", "config.json"),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8"
  );
}
