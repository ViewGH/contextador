import { MatrixClient } from "./client";
import { BudgetTracker, type BudgetTrackerOptions } from "./budget";
import { findMatchingBroadcast } from "./dedup";
import { buildBroadcast, buildRequest, isRequest } from "./rooms";
import { summarizeIfNeeded, isSummary, parseSummaryData } from "./summarizer";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

export interface MainframeConfig {
  operatorUrl: string;
  projectRoom: string;
  alertRoom?: string;
  budget: BudgetTrackerOptions;
  enabled: boolean;
  projectRoot?: string;
}

/** Load or create a persistent agent ID for this machine */
async function getOrCreateAgentId(projectRoot: string): Promise<string> {
  const idFile = join(projectRoot, ".contextador", "mainframe-agent.json");
  try {
    const raw = await readFile(idFile, "utf-8");
    const data = JSON.parse(raw);
    if (data.agentId) return data.agentId;
  } catch {}

  // Generate new ID and persist it
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "ctx-";
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];

  try {
    await mkdir(join(projectRoot, ".contextador"), { recursive: true });
    await writeFile(idFile, JSON.stringify({ agentId: id, createdAt: new Date().toISOString() }, null, 2), "utf-8");
  } catch {}

  return id;
}

export class MainframeBridge {
  private client!: MatrixClient;
  private budget: BudgetTracker;
  private config: MainframeConfig;
  private roomId: string | null = null;
  private alertRoomId: string | null = null;
  private cachedMessages: any[] = [];
  private lastSync = 0;
  private initialized = false;

  constructor(config: MainframeConfig) {
    this.config = config;
    // Client created in connect() after loading persistent agent ID
    this.client = new MatrixClient(config.operatorUrl, "ctx-pending");
    this.budget = new BudgetTracker(config.budget);
  }

  async connect(): Promise<boolean> {
    if (!this.config.enabled) return false;

    // Load persistent agent ID
    const projectRoot = this.config.projectRoot ?? process.cwd();
    const agentId = await getOrCreateAgentId(projectRoot);
    this.client = new MatrixClient(this.config.operatorUrl, agentId);

    try {
      await this.client.connect();
    } catch {
      this.client.startRetry();
      return false;
    }

    if (!this.client.isConnected()) {
      this.client.startRetry();
      return false;
    }

    // Join or create project room
    try {
      const result = await this.client.joinRoom(this.config.projectRoom) as any;
      this.roomId = result?.room_id ?? null;
    } catch {
      try {
        const alias = this.config.projectRoom.replace(/^#/, "").split(":")[0];
        const result = await this.client.createRoom(alias, `Contextador: ${alias}`) as any;
        this.roomId = result?.room_id ?? null;
      } catch {
        return false;
      }
    }

    // Join alert room
    if (this.config.alertRoom) {
      try {
        const result = await this.client.joinRoom(this.config.alertRoom) as any;
        this.alertRoomId = result?.room_id ?? null;
      } catch {}
    }

    // Load room budget
    try {
      const budgetState = await this.client.getState(this.roomId!, "m.ctx.budget") as any;
      if (budgetState) this.budget.updateRoomBudget(budgetState);
    } catch {}

    return true;
  }

  async checkHistory(queryHash: string): Promise<any | null> {
    if (!this.client.isConnected() || !this.roomId) return null;
    if (!this.budget.canRead()) return null;

    try {
      if (Date.now() - this.lastSync > 60000) {
        const result = await this.client.getMessages(this.roomId, 100) as any;
        this.cachedMessages = result?.chunk ?? [];
        this.lastSync = Date.now();
      }
      const match = findMatchingBroadcast(this.cachedMessages, queryHash);
      if (match) return match.pointers;
    } catch {}

    return null;
  }

  async postBroadcast(
    query: string,
    queryHash: string,
    scopes: string[],
    pointers: Record<string, unknown>,
    tokensUsed: number,
    contextValidated: string,
  ): Promise<void> {
    if (!this.client.isConnected() || !this.roomId) return;
    if (!this.budget.canSpend(tokensUsed)) return;

    try {
      const msg = buildBroadcast({
        query,
        queryHash,
        scopes,
        pointers,
        tokensUsed,
        agentId: this.client.agentId,
        contextValidated,
      });
      await this.client.sendMessage(this.roomId, msg);
      this.budget.record(tokensUsed);

      // Update room budget state
      const currentBudget = await this.client.getState(this.roomId, "m.ctx.budget") as any;
      if (currentBudget) {
        currentBudget.used_this_hour = (currentBudget.used_this_hour ?? 0) + tokensUsed;
        currentBudget.used_today = (currentBudget.used_today ?? 0) + tokensUsed;
        await this.client.setState(this.roomId, "m.ctx.budget", currentBudget);
      }

      // Alert at 80%
      if (this.budget.shouldAlert() && this.alertRoomId) {
        const status = this.budget.getStatus();
        await this.client.sendMessage(this.alertRoomId, {
          msgtype: "m.text",
          body: `Budget alert: ${this.client.agentId}: 80% of daily budget used (${status.usedToday}/${status.dailyLimit} tokens)`,
        });
      }
    } catch {}
  }

  kill(): void {
    this.budget.kill();
  }

  resume(): void {
    this.budget.resume();
  }

  getStatus() {
    return {
      connected: this.client.isConnected(),
      roomId: this.roomId,
      budget: this.budget.getStatus(),
      agentId: this.client.agentId,
    };
  }

  /** Run summarization if room has enough broadcasts */
  async summarizeRoom(): Promise<boolean> {
    if (!this.client.isConnected() || !this.roomId) return false;
    try {
      const messages = await this.client.getMessages(this.roomId, 200);
      return await summarizeIfNeeded(this.client, this.roomId, messages);
    } catch {
      return false;
    }
  }

  /** Try to acquire the janitor lock. Returns true if acquired. */
  async acquireJanitorLock(): Promise<boolean> {
    if (!this.client.isConnected() || !this.roomId) return true; // No mainframe = no lock needed
    try {
      const state = await this.client.getState(this.roomId, "m.ctx.janitor_lock") as any;
      if (state) {
        const lockedAt = new Date(state.locked_at).getTime();
        const now = Date.now();
        const staleMs = 10 * 60 * 1000; // 10 minutes
        if (state.locked && state.agent_id !== this.client.agentId && (now - lockedAt) < staleMs) {
          return false; // Another agent holds a fresh lock
        }
      }
      // Claim the lock
      await this.client.setState(this.roomId, "m.ctx.janitor_lock", {
        locked: true,
        agent_id: this.client.agentId,
        locked_at: new Date().toISOString(),
      });
      return true;
    } catch {
      return true; // On error, allow local sweep
    }
  }

  /** Release the janitor lock */
  async releaseJanitorLock(): Promise<void> {
    if (!this.client.isConnected() || !this.roomId) return;
    try {
      await this.client.setState(this.roomId, "m.ctx.janitor_lock", {
        locked: false,
        agent_id: this.client.agentId,
        released_at: new Date().toISOString(),
      });
    } catch {}
  }

  /** Check for pending task requests addressed to this agent */
  async checkForRequests(): Promise<Array<{ from: string; task: string; priority: string; eventId: string }>> {
    if (!this.client.isConnected() || !this.roomId) return [];
    try {
      // Refresh cache
      if (Date.now() - this.lastSync > 60000) {
        this.cachedMessages = await this.client.getMessages(this.roomId, 100);
        this.lastSync = Date.now();
      }

      const pending: Array<{ from: string; task: string; priority: string; eventId: string }> = [];
      for (const event of this.cachedMessages) {
        if (!isRequest(event)) continue;
        const data = event.content?.["m.ctx"]?.data;
        if (!data) continue;
        // Only show requests addressed to this agent or to "any"
        if (data.to !== this.client.agentId && data.to !== "any") continue;
        pending.push({
          from: event.sender ?? "unknown",
          task: data.task,
          priority: data.priority ?? "normal",
          eventId: event.event_id ?? "",
        });
      }
      return pending;
    } catch {
      return [];
    }
  }

  /** Post a task request for another agent (exempt from token budget — coordination is free) */
  async postRequest(to: string, task: string, priority: "normal" | "high" = "normal"): Promise<void> {
    if (!this.client.isConnected() || !this.roomId) return;
    // Requests are coordination messages — exempt from token budget
    // Only block if hard-killed
    if (!this.budget.canRead()) return;
    try {
      const msg = buildRequest({ to, task, priority });
      await this.client.sendMessage(this.roomId, msg);
    } catch {}
  }

  disconnect(): void {
    this.client.disconnect();
  }
}
