# Troubleshooting

## Quick Fix

Run `contextador doctor` for a full system diagnostic.

## Setup Issues

### "contextador: command not found"
```bash
bun install -g contextador
```

### "Docker not found" during Mainframe setup
Install Docker Desktop: https://docs.docker.com/get-docker/
Start Docker, then run `contextador setup` again.

### "Testing connection... ✗" for AI provider
- Check your API key is correct
- For custom servers: verify the URL is reachable (`curl <url>/models`)
- Run `contextador setup` to reconfigure

### Setup wizard won't start
Make sure Bun is installed: `curl -fsSL https://bun.sh/install | bash`

## Runtime Issues

### "No context found" for queries
- Run `contextador init -local` to generate CONTEXT.md files
- Or open Claude Code and say "initialize contextador"

### Context is stale or inaccurate
- Run `contextador sweep` to refresh
- Report issues via the `context_feedback` MCP tool so the system learns

### Mainframe won't connect
- Check Docker is running: `docker ps | grep contextador`
- Check Operator responds: `curl http://localhost:6167/_matrix/client/versions`
- Restart: `docker restart contextador-operator`
- Re-run setup: `contextador setup`

### Terminal art looks broken
- Widen your terminal to 148+ columns
- The compact banner shows automatically for narrow terminals

### "Another agent holds the janitor lock"
- Another agent is running a sweep — wait a few minutes
- If the lock is stuck (>10 minutes), it auto-expires

## Framework-Specific

### OpenClaw: contextador tools not appearing
- Check `skills/contextador/SKILL.md` exists in your workspace
- Re-run `contextador init` to regenerate it

### Hermes: tools not registered
- Check `CONTEXTADOR_HERMES.md` exists in your project
- Verify MCP config points to `contextador-mcp`

## Diagnostics

| Command | What it does |
|---------|-------------|
| `contextador doctor` | Full system health check |
| `contextador status` | Project overview |
| `contextador stats` | Token savings report |
| `contextador sweep` | Refresh stale docs |
