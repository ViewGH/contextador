# Contextador

> Codebase context system for AI agents — by [View AI](https://view-ai.com)

Contextador gives AI coding agents structured, efficient access to your codebase. Instead of agents scanning thousands of files to understand your code (~50-100K tokens), Contextador routes them to exactly what they need (~5K tokens). **93% token savings** on context-gathering queries.

## Features

- **Context routing** — ask a question, get back the exact files, types, dependencies, and tests that answer it
- **Self-healing docs** — CONTEXT.md files at every directory level, automatically validated and regenerated
- **Self-improving** — hit logging tracks what works, feedback loop learns from failures
- **Mainframe** — multi-agent context sharing via Operator (Matrix server). Agents on different machines share discoveries instead of duplicating work
- **Dynamic hierarchy** — adapts to any repo depth, from flat projects to deep monorepos
- **Budget controls** — per-agent and per-room token limits with kill switch
- **Works with any AI** — Anthropic, OpenAI, Google, GitHub Copilot, OpenRouter, Ollama, or Claude Code
- **MCP integration** — works natively with Claude Code, Cursor, and any MCP-compatible editor

## Quick Start

```bash
# Install
bun install -g contextador

# One-time setup (AI provider + optional Mainframe)
contextador setup

# Initialize on your project
cd your-project
contextador init

# Use with Claude Code (auto-detected via .mcp.json)
claude
> How does the auth system work?
# Agent uses contextador automatically
```

## How It Works

1. **`contextador init`** scans your codebase and generates CONTEXT.md files describing each module
2. **When an agent needs context**, it calls the `context` tool instead of reading files blindly
3. **Contextador routes the query** to the right part of the codebase and returns structured pointers
4. **The agent reads only the files it needs** — typically 2-3 files instead of 20-30
5. **If context was wrong**, the agent reports feedback and the system self-corrects

## Mainframe (Multi-Agent Sharing)

When multiple agents work on the same codebase, they waste tokens rediscovering what others already learned. Mainframe solves this:

- Agent A discovers how auth works → broadcasts to shared room
- Agent B needs the same info → finds it in room cache (free)
- No duplicate work, no wasted tokens

```bash
# Enable during setup
contextador setup
> Enable Mainframe? yes
> Starting Operator...
> ✓ Agents can now share context
```

Requires Docker for auto-setup, or bring your own Matrix server.

## Commands

```
contextador setup           — one-time setup (AI provider, Mainframe)
contextador init            — initialize on a project
contextador init -local     — initialize with local model server
contextador sweep           — refresh stale docs, detect changes
contextador status          — freshness report
contextador query <text>    — route a context query
contextador configure       — change settings
contextador demolish        — remove all contextador artifacts
```

## MCP Tools (for AI editors)

| Tool | Purpose |
|------|---------|
| `context` | Query codebase context |
| `context_feedback` | Report inaccurate context |
| `context_status` | Freshness + Mainframe status |
| `context_sweep` | Run the Janitor |
| `context_init` | Scaffold a project |
| `context_generate` | Generate CONTEXT.md for a scope |
| `mainframe_pause` | Pause sharing |
| `mainframe_resume` | Resume sharing |
| `mainframe_tasks` | Check pending task requests |
| `mainframe_request` | Post task for another agent |

## License

AGPL-3.0 — see [LICENSE](LICENSE)

Commercial licensing available — see [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md)

---

Built by [View AI](https://view-ai.com)
