# Contextador

> Your AI agents are wasting money reading your code. — [View AI](https://view-ai.com)

**Hitting your usage limit?** You're not using too many tokens on building things. You're burning them on *context* — agents reading dozens of files just to understand your codebase before they write a single line. That exploration eats 50-100K tokens per task. It's why you hit rate limits, why your Pro plan runs out mid-afternoon, and why running multiple agents gets expensive fast.

**Contextador fixes this.**

Every time you ask an AI agent to build something, it burns **50,000–100,000 tokens** just figuring out where things are. It reads 30 files. Backtracks. Reads 20 more. Grepping, guessing, exploring — before it writes a single line of code.

Multiply that by every task, every agent, every developer on your team.

Contextador maps your entire codebase into structured context that agents can query instantly. Instead of reading 30 files (~50K tokens), the agent asks one question and gets back exactly the 2-3 files it needs (~500 tokens).

**93% fewer tokens. Same results. Fewer rate limits.**

Contextador maps your entire codebase into structured context that agents can query instantly. Instead of reading 30 files (~50K tokens), the agent asks one question and gets back exactly the 2-3 files it needs (~500 tokens).

**93% fewer tokens. Same results. Every query.**

And it gets smarter every time you use it. When an agent discovers something, that knowledge feeds back into the system. When context is wrong, agents report it and Contextador fixes itself. When multiple agents work on the same codebase, they share discoveries through Mainframe — so no agent ever rediscovers what another already learned.

```
Without Contextador:    Agent reads 30 files     →  ~50,000 tokens  →  slow, expensive
With Contextador:       Agent asks one question   →  ~500 tokens     →  instant, cheap
With Mainframe:         Agent finds cached answer →  ~0 tokens       →  free
```

## Why It Matters

- **Save money** — 93% token reduction on every context-gathering query
- **Ship faster** — agents spend time building, not exploring
- **Scale agents** — Mainframe prevents duplicate work across machines and developers
- **Self-healing** — documentation stays accurate without manual maintenance
- **Self-improving** — the system learns from every query and every failure
- **Works everywhere** — Claude Code, Cursor, OpenClaw, Hermes, or any MCP-compatible tool
- **Any AI provider** — Anthropic, OpenAI, Google, GitHub Copilot, OpenRouter, Ollama, or local models
- **Your infrastructure** — runs locally, your data stays on your machines

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
