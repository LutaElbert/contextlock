# ContextLock

Vibe code safely in real repos. ContextLock is a local-first MCP safety layer that blocks dangerous files and redacts secrets before AI agents see project context.

```bash
npx contextlock init
npx contextlock scan
npx contextlock mcp
```

## Why

AI coding agents get better with more context, but real repos contain secrets, credentials, private keys, database URLs, and client data. ContextLock sits between MCP-compatible AI clients and your project files so agents can inspect useful code without seeing values they should never receive.

```text
AI client
Cursor / Claude / Codex
        |
        | local stdio MCP
        v
ContextLock
        |
        | block + redact + audit
        v
Local repo
```

## Current MVP

- `contextlock init` creates a local `contextlock.config.json`.
- `contextlock scan` finds blocked files and redactable secrets.
- `contextlock mcp` starts a local stdio MCP server.
- `contextlock mcp-config` prints a client config snippet.
- MCP tools:
  - `repo.list_files`
  - `repo.read_file_safe`
  - `repo.search_safe`
  - `repo.scan_risks`
  - `policy.explain`

## Local Development

This repo uses Node.js 20+ and pnpm.

```bash
pnpm install
pnpm build
pnpm dev -- scan
pnpm test:mcp
```

Start the MCP server locally:

```bash
pnpm dev -- mcp
```

`pnpm test:mcp` builds the CLI, connects to it as a real stdio MCP client,
checks tool discovery, and calls policy, listing, and safe-read tools. The same
test runs on Node.js 20 and 22 in GitHub Actions.

## MCP Client Config

After publishing, clients can launch ContextLock with:

```json
{
  "mcpServers": {
    "contextlock": {
      "command": "npx",
      "args": ["contextlock", "mcp"]
    }
  }
}
```

During local development, use:

```json
{
  "mcpServers": {
    "contextlock": {
      "command": "pnpm",
      "args": ["dev", "--", "mcp"]
    }
  }
}
```

## Product Direction

ContextLock starts as an open local tool for freelancers, solo developers, and agencies. Paid features can come later around advanced reports, premium rule packs, team policy sync, database sanitization, and enterprise audit exports.

Core promise:

> No cloud required. Your code stays local.

## License

Apache-2.0
