/**
 * Room summarization for the mainframe multi-agent sharing layer.
 * Aggregates broadcast messages into scope-level digests.
 */

import { isBroadcast, parseBroadcast, type BroadcastData } from "./rooms";
import { MatrixClient } from "./client";

export interface ScopeDigest {
  scope: string;
  queryCount: number;
  queries: string[];
  lastSeen: string;
  totalTokens: number;
}

export interface RoomSummary {
  generatedAt: string;
  broadcastCount: number;
  scopes: ScopeDigest[];
}

const SUMMARIZE_THRESHOLD = 50;

/** Build a summary from room messages */
export function buildSummary(events: any[]): RoomSummary | null {
  const broadcasts = events.filter(e => isBroadcast(e));
  if (broadcasts.length < SUMMARIZE_THRESHOLD) return null;

  const scopeMap = new Map<string, ScopeDigest>();

  for (const event of broadcasts) {
    const data = parseBroadcast(event);
    if (!data) continue;

    for (const scope of data.scopes) {
      let digest = scopeMap.get(scope);
      if (!digest) {
        digest = { scope, queryCount: 0, queries: [], lastSeen: "", totalTokens: 0 };
        scopeMap.set(scope, digest);
      }
      digest.queryCount++;
      if (!digest.queries.includes(data.query) && digest.queries.length < 10) {
        digest.queries.push(data.query);
      }
      const ts = event.content?.["m.ctx"]?.data?.timestamp ?? "";
      if (ts > digest.lastSeen) digest.lastSeen = ts;
      digest.totalTokens += data.tokensUsed;
    }
  }

  // Sort by query count descending
  const scopes = Array.from(scopeMap.values()).sort((a, b) => b.queryCount - a.queryCount);

  return {
    generatedAt: new Date().toISOString(),
    broadcastCount: broadcasts.length,
    scopes,
  };
}

/** Serialize a summary to a readable text format */
export function serializeSummary(summary: RoomSummary): string {
  const lines: string[] = [];
  lines.push(`## Room Summary (${summary.broadcastCount} broadcasts)`);
  lines.push(`Generated: ${summary.generatedAt}\n`);

  for (const scope of summary.scopes) {
    lines.push(`**${scope.scope}** — ${scope.queryCount} queries, ${scope.totalTokens} tokens`);
    lines.push(`  Last: ${scope.lastSeen}`);
    lines.push(`  Queries: ${scope.queries.slice(0, 5).join("; ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

/** Build the Matrix message for a summary */
export function buildSummaryMessage(summary: RoomSummary): any {
  return {
    msgtype: "m.text",
    body: serializeSummary(summary),
    "m.ctx": {
      type: "summary",
      data: summary,
    },
  };
}

/** Check if an event is a summary */
export function isSummary(event: any): boolean {
  return event?.content?.["m.ctx"]?.type === "summary";
}

/** Parse summary data from an event */
export function parseSummaryData(event: any): RoomSummary | null {
  if (!isSummary(event)) return null;
  return event.content?.["m.ctx"]?.data ?? null;
}

/** Post a summary to the room if threshold is met */
export async function summarizeIfNeeded(client: MatrixClient, roomId: string, events: any[]): Promise<boolean> {
  const summary = buildSummary(events);
  if (!summary) return false;

  const msg = buildSummaryMessage(summary);
  await client.sendMessage(roomId, msg);
  return true;
}
