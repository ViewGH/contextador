/**
 * Room message types for the mainframe multi-agent sharing layer.
 * Builders and parsers for broadcast and request messages over Matrix.
 */

export interface BroadcastData {
  query: string;
  queryHash: string;
  scopes: string[];
  pointers: Record<string, unknown>;
  tokensUsed: number;
  agentId: string;
  contextValidated: string;
}

export interface RequestData {
  to: string;
  task: string;
  priority: string;
}

interface CtxEnvelope {
  msgtype: "m.text";
  body: string;
  "m.ctx": {
    type: "broadcast" | "request";
    data: Record<string, unknown>;
  };
}

interface MatrixEvent {
  content: CtxEnvelope;
}

// ---------- builders ----------

export function buildBroadcast(data: BroadcastData): CtxEnvelope {
  return {
    msgtype: "m.text",
    body: `[broadcast] ${data.agentId}: ${data.query} (${data.tokensUsed} tokens)`,
    "m.ctx": {
      type: "broadcast",
      data: {
        query: data.query,
        query_hash: data.queryHash,
        scopes: data.scopes,
        pointers: data.pointers,
        tokens_used: data.tokensUsed,
        agent_id: data.agentId,
        context_validated: data.contextValidated,
      },
    },
  };
}

export function buildRequest(data: RequestData): CtxEnvelope {
  return {
    msgtype: "m.text",
    body: `[request] -> ${data.to}: ${data.task} (${data.priority})`,
    "m.ctx": {
      type: "request",
      data: {
        to: data.to,
        task: data.task,
        priority: data.priority,
      },
    },
  };
}

// ---------- type guards ----------

export function isBroadcast(event: MatrixEvent): boolean {
  return event.content?.["m.ctx"]?.type === "broadcast";
}

export function isRequest(event: MatrixEvent): boolean {
  return event.content?.["m.ctx"]?.type === "request";
}

// ---------- parsers ----------

export function parseBroadcast(event: MatrixEvent): BroadcastData | null {
  if (!isBroadcast(event)) return null;
  const d = event.content["m.ctx"].data;
  return {
    query: d.query as string,
    queryHash: d.query_hash as string,
    scopes: d.scopes as string[],
    pointers: d.pointers as Record<string, unknown>,
    tokensUsed: d.tokens_used as number,
    agentId: d.agent_id as string,
    contextValidated: d.context_validated as string,
  };
}
