/**
 * GitHub Webhook Server
 *
 * Listens for push events on configured branches, triages the diff
 * through the local model, and triggers targeted janitor sweeps
 * only when the context is insufficient.
 *
 * Uses Bun's native HTTP server — no dependencies.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { loadConfig, saveConfig } from "../core/projectconfig";
import { freshnessSweep, processRepairQueue } from "../core/janitor";
import { generateContextContent } from "../core/generator";
import { stampContextFile } from "../core/freshness";
import { generateBriefing } from "../core/briefing";
import { buildHierarchyConfig } from "../core/hierarchy";
import { syncServiceIndex, syncArchitectureDeps } from "../core/docsync";
import { triagePush } from "./triage";
import type { GitHubPushPayload, WebhookConfig, WebhookEvent } from "./types";

const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  enabled: false,
  port: 9471,
  secret: "",
  branches: ["main", "master"],
};

const MAX_EVENT_LOG = 100;

/**
 * Verify GitHub webhook signature (HMAC-SHA256).
 */
async function verifySignature(
  payload: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!secret) return true; // No secret configured — skip verification
  if (!signature) return false;

  const prefix = "sha256=";
  if (!signature.startsWith(prefix)) return false;

  const sigHex = signature.slice(prefix.length);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (computed.length !== sigHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ sigHex.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Log a webhook event to .contextador/webhook-events.json
 */
async function logEvent(root: string, event: WebhookEvent): Promise<void> {
  const ctxDir = join(root, ".contextador");
  await mkdir(ctxDir, { recursive: true });
  const logPath = join(ctxDir, "webhook-events.json");

  let events: WebhookEvent[] = [];
  try {
    const raw = await readFile(logPath, "utf-8");
    events = JSON.parse(raw);
    if (!Array.isArray(events)) events = [];
  } catch {
    events = [];
  }

  events.unshift(event);
  if (events.length > MAX_EVENT_LOG) events = events.slice(0, MAX_EVENT_LOG);

  await writeFile(logPath, JSON.stringify(events, null, 2), "utf-8");
}

/**
 * Run a targeted sweep on specific scopes.
 * Unlike the full janitor, this only regenerates affected CONTEXT.md files.
 */
async function targetedSweep(root: string, scopes: string[]): Promise<string[]> {
  const actions: string[] = [];
  const ctxDir = join(root, ".contextador");

  for (const scope of scopes) {
    const contextPath = join(root, scope, "CONTEXT.md");
    try {
      const content = await generateContextContent(root, scope);
      await writeFile(contextPath, content, "utf-8");
      actions.push(`regenerated: ${scope}`);
    } catch (err) {
      // If generation fails, at least stamp it
      try {
        await stampContextFile(root, contextPath);
        actions.push(`stamped (regen failed): ${scope}`);
      } catch {
        actions.push(`failed: ${scope} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Regenerate derived artifacts if anything was updated
  if (actions.some((a) => a.startsWith("regenerated"))) {
    try {
      const briefing = await generateBriefing(root);
      await writeFile(join(ctxDir, "briefing.md"), briefing, "utf-8");
      actions.push("refreshed briefing.md");
    } catch {
      // Non-critical
    }

    try {
      const config = await buildHierarchyConfig(root);
      await writeFile(join(ctxDir, "hierarchy.json"), JSON.stringify(config, null, 2), "utf-8");
      actions.push("refreshed hierarchy.json");
    } catch {
      // Non-critical
    }

    try {
      await syncServiceIndex(root);
      actions.push("refreshed service-index.md");
    } catch {}

    try {
      await syncArchitectureDeps(root);
      actions.push("refreshed architecture deps");
    } catch {}
  }

  return actions;
}

/**
 * Handle an incoming webhook request.
 */
async function handleWebhook(
  root: string,
  webhookConfig: WebhookConfig,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);

  // Health check
  if (url.pathname === "/health" || url.pathname === "/") {
    return new Response(
      JSON.stringify({ status: "ok", service: "contextador-webhook" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Only accept POST to /webhook
  if (req.method !== "POST" || url.pathname !== "/webhook") {
    return new Response("Not Found", { status: 404 });
  }

  // Read and verify payload
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const eventType = req.headers.get("x-github-event");

  if (!(await verifySignature(body, signature, webhookConfig.secret))) {
    return new Response(JSON.stringify({ error: "invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only handle push events
  if (eventType === "ping") {
    return new Response(JSON.stringify({ status: "pong" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (eventType !== "push") {
    return new Response(
      JSON.stringify({ status: "ignored", reason: `event type: ${eventType}` }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  let payload: GitHubPushPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check branch filter
  const branch = payload.ref.replace("refs/heads/", "");
  if (!webhookConfig.branches.includes(branch)) {
    return new Response(
      JSON.stringify({ status: "ignored", reason: `branch ${branch} not watched` }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Pull latest changes first
  try {
    const proc = Bun.spawn(["git", "pull", "--ff-only"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
  } catch {
    // Non-fatal — we might be on a bare clone or have local changes
  }

  // Triage the push
  const triage = await triagePush(root, payload);

  // Log the event
  const event: WebhookEvent = {
    receivedAt: new Date().toISOString(),
    repo: payload.repository.full_name,
    branch,
    commits: payload.commits.length,
    triage,
    swept: false,
  };

  if (triage.shouldUpdate) {
    // Targeted sweep on affected scopes only
    const actions = await targetedSweep(root, triage.affectedScopes);
    event.swept = true;

    await logEvent(root, event);

    return new Response(
      JSON.stringify({
        status: "swept",
        scopes: triage.affectedScopes,
        actions,
        reason: triage.reason,
        filesChanged: triage.filesChanged,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Context is already sufficient — skip
  await logEvent(root, event);

  return new Response(
    JSON.stringify({
      status: "skipped",
      reason: triage.reason,
      filesChanged: triage.filesChanged,
      scopesChecked: triage.affectedScopes.length || "all trivial",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Start the webhook server.
 */
export async function startWebhookServer(
  root: string,
  configOverrides?: Partial<WebhookConfig>,
  options?: { noVerify?: boolean },
): Promise<{ server: ReturnType<typeof Bun.serve>; port: number }> {
  const projectConfig = await loadConfig(root);
  const webhookConfig: WebhookConfig = {
    ...DEFAULT_WEBHOOK_CONFIG,
    ...(projectConfig as any).webhook,
    ...configOverrides,
  };

  if (!webhookConfig.secret && !options?.noVerify) {
    throw new Error(
      "Webhook secret is not configured. Set 'webhook.secret' in .contextador/config.json " +
      "or pass --no-verify to start without signature verification (NOT recommended for production)."
    );
  }

  const server = Bun.serve({
    port: webhookConfig.port,
    fetch: (req) => handleWebhook(root, webhookConfig, req),
  });

  return { server, port: server.port };
}

/**
 * Get webhook config with defaults.
 */
export function getWebhookDefaults(): WebhookConfig {
  return { ...DEFAULT_WEBHOOK_CONFIG };
}

/**
 * Get recent webhook events.
 */
export async function getWebhookEvents(root: string, limit = 10): Promise<WebhookEvent[]> {
  try {
    const raw = await readFile(join(root, ".contextador", "webhook-events.json"), "utf-8");
    const events = JSON.parse(raw);
    return Array.isArray(events) ? events.slice(0, limit) : [];
  } catch {
    return [];
  }
}
