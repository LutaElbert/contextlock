<div align="center">
  <img src="assets/social-preview.jpg" alt="ContextLock - safe context for AI coding agents" width="100%">

# ContextLock

**A local-first MCP safety layer for AI coding agents.**

Block sensitive files and redact common secrets before repository context reaches an AI client.

[![CI](https://github.com/LutaElbert/contextlock/actions/workflows/ci.yml/badge.svg)](https://github.com/LutaElbert/contextlock/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/contextlock)](https://www.npmjs.com/package/contextlock)
[![Release](https://img.shields.io/github/v/release/LutaElbert/contextlock?display_name=tag)](https://github.com/LutaElbert/contextlock/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

</div>

> [!IMPORTANT]
> ContextLock `1.x` is the stable CLI and MCP contract line. Pin a specific
> version in shared automation if you need repeatable behavior.

The npm package is intentionally CLI-only; importing `contextlock` as a library
is not a supported API. See [Stability Policy](docs/STABILITY.md) for the stable
contracts, limitations, SemVer policy, and release checklist.

## Why ContextLock?

AI coding agents are more useful with repository context, but real projects can
contain `.env` files, private keys, database URLs, credentials, webhooks, and
client data. ContextLock provides a controlled local boundary between an
MCP-compatible AI client and a project:

```text
AI coding client
      |
      | local stdio MCP
      v
 ContextLock
      |
      | block files + redact values + report risks
      v
 Local repository
```

- **Local-first:** repository content is processed on your machine.
- **Blocked by policy:** sensitive files never appear in safe file listings or
  reads.
- **Redacted before return:** supported secret patterns are replaced with clear
  placeholders.
- **Inspectable:** scan and report commands show what the active policy finds.
- **Configurable:** each project can maintain its own policy file.

## Quick Start

ContextLock requires Node.js 22.13+.

Run it without installing:

```bash
npx contextlock --help
```

Initialize a policy in the repository you want to protect, then scan it:

```bash
cd /path/to/your/project
npx contextlock init
npx contextlock scan
npx contextlock report
```

Start the MCP server from the project being protected:

```bash
npx contextlock mcp
```

Or install it globally:

```bash
npm install -g contextlock
contextlock scan
```

## MCP Client Setup

Configure your coding agent to launch ContextLock from the repository you want
to protect. The examples below use `npx` so the published npm package is used.

| Coding agent | Setup method | Scope |
| --- | --- | --- |
| Codex | `codex mcp add` | User configuration |
| Claude Code | `claude mcp add` | Current project by default |
| Cursor | `.cursor/mcp.json` | Current workspace |
| VS Code with GitHub Copilot | `.vscode/mcp.json` | Current workspace |

### Codex

From the repository you want ContextLock to protect:

```bash
codex mcp add contextlock -- \
  npx contextlock mcp
codex mcp list
```

Restart Codex or begin a new session in that repository, then ask it to use
`repo.scan_risks`. See the official [Codex MCP documentation](https://developers.openai.com/codex/mcp/)
for configuration details.

### Claude Code

From the repository you want to protect, add ContextLock with local scope:

```bash
claude mcp add --scope local --transport stdio contextlock -- \
  npx contextlock mcp
claude mcp get contextlock
```

Start Claude Code in the same repository and run `/mcp` to check the server.
Use `--scope project` instead if you intentionally want to share a `.mcp.json`
configuration with collaborators. See the official [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

### Cursor

Create `.cursor/mcp.json` in the repository you want to protect:

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

Open that repository in Cursor, then open **Settings > Tools & MCP** and enable
`contextlock`. Cursor should discover the five tools after the server starts.
See the official [Cursor MCP documentation](https://docs.cursor.com/context/model-context-protocol).

### VS Code with GitHub Copilot

Create `.vscode/mcp.json` in the repository you want to protect. VS Code uses a
top-level `servers` key rather than `mcpServers`:

```json
{
  "servers": {
    "contextlock": {
      "type": "stdio",
      "command": "npx",
      "args": ["contextlock", "mcp"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

Run **MCP: List Servers** from the Command Palette, start `contextlock`, and
accept the workspace trust prompt after reviewing the command. See the official
[VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

### Verify the Connection

After setup, confirm that the agent discovers these five tools:

```text
repo.list_files
repo.read_file_safe
repo.search_safe
repo.scan_risks
policy.explain
```

Ask the agent to run `policy.explain`, then `repo.scan_risks`. If the server
does not start:

- Confirm `node --version` is 22.13 or newer.
- Confirm `npx contextlock --help` works in a terminal.
- Confirm the agent was opened in the repository you intend to protect.
- Check the agent's MCP server logs for process startup errors.

`contextlock mcp-config` prints a generic configuration snippet.

## Agent Skill

ContextLock includes an optional [Agent Skills](https://agentskills.io/)
workflow in [`skills/contextlock`](skills/contextlock). The MCP server enforces
blocking and redaction; the skill teaches an agent when to use the five safe
tools, how to handle denied access, and not to bypass the active policy.

Install the skill in the repository you want to protect. Choose the directory
for your coding agent:

| Coding agent | Project skill directory |
| --- | --- |
| Codex | `.agents/skills/contextlock/` |
| Claude Code | `.claude/skills/contextlock/` |
| Cursor | `.cursor/skills/contextlock/` |
| VS Code with GitHub Copilot | `.github/skills/contextlock/` |

For example, install it for Codex from the protected repository:

```bash
mkdir -p .agents/skills/contextlock
cp /absolute/path/to/contextlock/skills/contextlock/SKILL.md \
  .agents/skills/contextlock/SKILL.md
```

Use the corresponding directory from the table for another agent. Restart the
agent or begin a new session after installation, then ask it to "inspect this
repository safely with ContextLock." The agent should start with
`policy.explain` and `repo.scan_risks` before reading project files.

The skill complements the MCP setup above; it does not install or start the
ContextLock server by itself.

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `repo.list_files` | List text files allowed by the active policy. |
| `repo.read_file_safe` | Read an allowed file with supported secrets redacted. |
| `repo.search_safe` | Search allowed text content and return redacted snippets. |
| `repo.scan_risks` | Summarize blocked files and detected secret patterns. |
| `policy.explain` | Show the active blocking and redaction policy. |

## Default Protection

Running `contextlock init` creates `contextlock.config.json`. The default policy
blocks common sensitive or generated paths, including:

- `.env` files, private keys, credentials, service-account files, and database
  files
- dependency and build output such as `node_modules`, `dist`, `.next`, and
  `.turbo`
- Git internals under `.git`

Allowed text files are scanned for supported API keys, JWTs, database URLs,
private keys, and Slack or Discord webhook URLs. Email redaction is available
but disabled by default.

Example configuration:

```json
{
  "schemaVersion": 1,
  "blockedPatterns": [
    ".env",
    ".env.*",
    "**/*.pem",
    "**/*.key",
    "**/credentials.json",
    "**/node_modules/**",
    "**/.git/**"
  ],
  "redact": {
    "apiKeys": true,
    "jwt": true,
    "databaseUrls": true,
    "privateKeys": true,
    "webhooks": true,
    "emails": false
  }
}
```

ContextLock reads `contextlock.config.json` from the process working directory
(`cwd`), which is also the root for relative paths and policy matching. It does
not automatically move to the nearest Git root. Set the MCP process `cwd` to
the repository you intend to protect.

Configuration is additive. `blockedPatterns` adds unique patterns to the
baseline list, and `redact` can enable additional redactors; config cannot turn
off baseline protections. `schemaVersion: 1` is required when a config file is
present. Unknown fields, unsupported schema versions, invalid values, and
symlinked config files are rejected with an error.

> [!WARNING]
> ContextLock reduces accidental exposure; it is not a secret manager, malware
> scanner, sandbox, or guarantee that every sensitive value will be detected.
> Keep credentials out of source control and review your project policy before
> granting an AI client access.

## Development

Clone the repository when you want to contribute or test local changes:

```bash
git clone git@github.com:LutaElbert/contextlock.git
cd contextlock
```

```bash
pnpm install --frozen-lockfile
pnpm test
```

The aggregate test command covers scanner and policy behavior, CLI and MCP
smokes, the bundled skill, type checking, and installation from the generated
npm tarball. CI runs it on the minimum Node.js 22.13 release and Node.js 24.

For development against this repository:

```bash
pnpm dev -- scan
pnpm dev -- mcp
pnpm dev -- mcp-config --local
```

## Roadmap

- Expand secret detection and policy test coverage.
- Improve audit reports and machine-readable findings.
- Improve package setup examples for more coding agents.
- Add premium policy packs, team policy sync, database sanitization, and
  enterprise audit exports without weakening the local-first core.

Core promise: **No cloud required. Your code stays local.**

## Releases

npm packages and GitHub releases are published through the
[Release workflow](https://github.com/LutaElbert/contextlock/actions/workflows/release.yml)
after the package version is updated on `main`.

1. Update `package.json` to the next version in a pull request.
2. Merge the pull request into `main`.
3. Open the **Release** workflow and choose **Run workflow**.
4. Enter the matching tag, such as `v1.0.0` or `v1.0.0-rc.1`, set the prerelease
   input consistently, and run it.

The main-only workflow validates the tag and prerelease state before installing
dependencies, runs the complete suite, publishes with provenance, and creates a
GitHub release. Prereleases use npm's `next` tag. Retrying is safe when the npm
version or GitHub release already exists. The workflow requires an `NPM_TOKEN`
repository secret with npm package publishing permissions.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening
a pull request, follow the [Code of Conduct](CODE_OF_CONDUCT.md), and use only
synthetic or redacted test data.

Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## License

ContextLock is licensed under the [Apache License 2.0](LICENSE).
