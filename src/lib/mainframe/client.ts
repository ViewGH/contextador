/**
 * Matrix client for the mainframe multi-agent sharing layer.
 * Uses raw fetch against the Operator server (Matrix protocol) — no SDK needed.
 */

function randomId(len = 4): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export class MatrixClient {
  readonly serverUrl: string;
  readonly agentId: string;

  private accessToken: string | null = null;
  private userId: string | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private txnCounter = 0;

  constructor(serverUrl: string, agentId?: string) {
    this.serverUrl = serverUrl;
    this.agentId = agentId ?? `ctx-${randomId(4)}`;
  }

  // ── Auth ──────────────────────────────────────────────────────────

  /** Try login, fall back to register. */
  async connect(): Promise<void> {
    const username = this.agentId;
    const password = this.agentId;

    try {
      await this.login(username, password);
    } catch {
      await this.register(username, password);
    }
  }

  private async login(username: string, password: string): Promise<void> {
    const res = await this.rawFetch("POST", "/_matrix/client/v3/login", {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: username },
      password,
    });
    if (!res.ok) throw new Error(`login failed: ${res.status}`);
    const data = await res.json();
    this.accessToken = data.access_token;
    this.userId = data.user_id;
  }

  private async register(username: string, password: string): Promise<void> {
    const res = await this.rawFetch("POST", "/_matrix/client/v3/register", {
      auth: { type: "m.login.dummy" },
      username,
      password,
    });
    if (!res.ok) throw new Error(`register failed: ${res.status}`);
    const data = await res.json();
    this.accessToken = data.access_token;
    this.userId = data.user_id;
  }

  /** Clear state and stop retry timer. */
  disconnect(): void {
    this.accessToken = null;
    this.userId = null;
    this.stopRetry();
  }

  /** Background reconnection every 5 minutes. */
  startRetry(): void {
    this.stopRetry();
    this.retryTimer = setInterval(async () => {
      if (this.isConnected()) return;
      try {
        await this.connect();
      } catch {
        // silent — will retry next interval
      }
    }, 5 * 60 * 1000);
  }

  private stopRetry(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // ── Fetch helpers ─────────────────────────────────────────────────

  /** Authenticated fetch wrapper with 3s timeout. */
  async api(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.rawFetch(method, path, body, true);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  private async rawFetch(
    method: string,
    path: string,
    body?: unknown,
    auth = false,
  ): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth && this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    return fetch(`${this.serverUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
  }

  // ── Messages ──────────────────────────────────────────────────────

  /** Send a message event (m.room.message). */
  async sendMessage(roomId: string, content: Record<string, unknown>): Promise<unknown> {
    const txnId = `${this.agentId}-${Date.now()}-${this.txnCounter++}`;
    const encoded = encodeURIComponent(roomId);
    return this.api(
      "PUT",
      `/_matrix/client/v3/rooms/${encoded}/send/m.room.message/${txnId}`,
      content,
    );
  }

  /** GET /messages backwards. */
  async getMessages(roomId: string, limit = 50): Promise<unknown> {
    const encoded = encodeURIComponent(roomId);
    return this.api(
      "GET",
      `/_matrix/client/v3/rooms/${encoded}/messages?dir=b&limit=${limit}`,
    );
  }

  // ── State ─────────────────────────────────────────────────────────

  async getState(roomId: string, eventType: string, stateKey = ""): Promise<unknown> {
    const r = encodeURIComponent(roomId);
    const e = encodeURIComponent(eventType);
    const s = encodeURIComponent(stateKey);
    return this.api("GET", `/_matrix/client/v3/rooms/${r}/state/${e}/${s}`);
  }

  async setState(
    roomId: string,
    eventType: string,
    content: Record<string, unknown>,
    stateKey = "",
  ): Promise<unknown> {
    const r = encodeURIComponent(roomId);
    const e = encodeURIComponent(eventType);
    const s = encodeURIComponent(stateKey);
    return this.api("PUT", `/_matrix/client/v3/rooms/${r}/state/${e}/${s}`, content);
  }

  // ── Rooms ─────────────────────────────────────────────────────────

  async joinRoom(roomIdOrAlias: string): Promise<unknown> {
    const encoded = encodeURIComponent(roomIdOrAlias);
    return this.api("POST", `/_matrix/client/v3/join/${encoded}`, {});
  }

  async createRoom(alias: string, name: string): Promise<unknown> {
    return this.api("POST", `/_matrix/client/v3/createRoom`, {
      room_alias_name: alias,
      name,
      visibility: "private",
      preset: "public_chat",  // Allow any registered user to join
    });
  }

  // ── Getters ───────────────────────────────────────────────────────

  isConnected(): boolean {
    return this.accessToken !== null;
  }

  getUserId(): string | null {
    return this.userId;
  }
}
