/** Generate OpenClaw SKILL.md for contextador integration */
export function generateOpenClawSkill(): string {
  return `---
name: contextador
description: REQUIRED before reading source files. Call the context tool for ANY question about the codebase — what something does, where it is, what to modify, what depends on what. Saves 93% of tokens.
requirements:
  binaries:
    - contextador-mcp
---

# Contextador

## ACTIVATION RULE

When the user asks ANY question about the codebase, or asks you to build, modify, fix, or understand ANYTHING in the code — call the \`context\` tool FIRST. Do not read source files until context has told you which files to read.

The only exception: if you already know the exact file path, read it directly.

## How to use it

1. Call the \`context\` tool with your question about the codebase
2. Read ONLY the Key Files listed in the response
3. If the context was wrong or incomplete, call \`context_feedback\` with what was missing
4. After making changes, call \`context_sweep\` to refresh documentation

## Token Efficiency Rules

- ALWAYS use \`context\` before reading files — it costs ~500 tokens vs ~25,000 for manual exploration
- Trust the pointers. Read the listed files first. Only explore further if they don't answer your question.
- If you explored beyond the pointers, report what was missing via \`context_feedback\`
- Check \`context_stats\` periodically to monitor token savings

## Multi-Agent Coordination (Mainframe)

When working with other agents:
- Context queries are automatically shared via Mainframe rooms
- Before querying, check if another agent already answered your question (automatic)
- Your discoveries are broadcast to help other agents
- Use \`mainframe_request\` to delegate tasks to other agents
- Check \`mainframe_tasks\` for work assigned to you
`;
}

/** Generate OpenClaw MCP config snippet */
export function generateOpenClawMcpConfig(): Record<string, any> {
  return {
    contextador: {
      command: "contextador-mcp",
      args: [],
      transport: "stdio",
    },
  };
}
