/** Generate Hermes MCP config for contextador */
export function generateHermesMcpConfig(): Record<string, any> {
  return {
    mcpServers: {
      contextador: {
        command: "contextador-mcp",
        args: [],
        env: {},
      },
    },
  };
}

/** Generate a Hermes toolset registration hint */
export function generateHermesToolGuide(): string {
  return `# Contextador Integration for Hermes Agent

Contextador is registered as an MCP server. Your Hermes agent will discover these tools automatically:

- \`mcp_contextador_context\` — Ask about codebase structure (USE FIRST)
- \`mcp_contextador_context_feedback\` — Report inaccurate context
- \`mcp_contextador_context_status\` — Check freshness and status
- \`mcp_contextador_context_sweep\` — Refresh stale documentation
- \`mcp_contextador_context_stats\` — View token savings
- \`mcp_contextador_mainframe_tasks\` — Check pending tasks from other agents
- \`mcp_contextador_mainframe_request\` — Delegate work to other agents

## Token Efficiency

Always call \`mcp_contextador_context\` before reading files manually.
It costs ~500 tokens vs ~25,000 for blind exploration.

If the context was incomplete, call \`mcp_contextador_context_feedback\`
with the files you had to read. This enriches the context for future queries.

## Multi-Agent Coordination

Mainframe rooms enable Hermes agents to share discoveries automatically.
When one agent learns something, all other agents benefit on the next query.
Use \`mcp_contextador_mainframe_request\` to delegate subtasks.
`;
}
