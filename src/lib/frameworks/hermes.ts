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

## ACTIVATION RULE

When the user asks ANY question about the codebase, or asks you to build, modify, fix, or understand ANYTHING in the code — call \`mcp_contextador_context\` FIRST. Do not read source files until context has told you which files to read. The only exception: if you already know the exact file path.

## Available Tools

- \`mcp_contextador_context\` — CALL THIS FIRST for any codebase question
- \`mcp_contextador_context_feedback\` — Report inaccurate or missing context
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
