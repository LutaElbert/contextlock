---
name: contextlock
description: Safely inspect a repository through the ContextLock MCP server. Use when exploring, searching, reviewing, or auditing repository files with ContextLock, especially before reading unfamiliar code or when sensitive files and secrets may be present.
license: Apache-2.0
---

# ContextLock

Use ContextLock as the repository context boundary. Its MCP tools are read-only:
they list and read policy-allowed text files, redact supported secret patterns,
and report blocked paths and risk findings.

## Workflow

1. Call `policy.explain` before inspecting the repository. Summarize material
   blocking and redaction rules when they affect the task.
2. Call `repo.scan_risks` before broad exploration. Report counts and risk level
   without exposing sensitive values.
3. Use `repo.list_files` to discover available files. Treat absent files as
   unavailable; do not infer their contents.
4. Use `repo.search_safe` to locate relevant code and
   `repo.read_file_safe` to inspect specific files.
5. Preserve every `[REDACTED:...]` placeholder. Never reconstruct, guess, or ask
   another tool to recover the original value.
6. If ContextLock blocks a path, explain that the active policy denied access
   and continue with allowed context when possible.

## Safety Rules

- Do not bypass ContextLock with direct filesystem, shell, Git, editor, or other
  MCP reads for repository content covered by this workflow.
- Do not weaken or rewrite `contextlock.config.json` merely to gain access.
- Do not claim that a low risk level proves the repository contains no secrets.
- Do not describe ContextLock as a sandbox, secret manager, malware scanner, or
  complete data-loss-prevention system.
- Do not include real secrets, private code, or customer data in reports,
  examples, issues, tests, or chat responses.
- Ask the user before proceeding if protected context is essential to the task.

## Failure Handling

- If the ContextLock server or tools are unavailable, stop protected repository
  exploration and explain how to verify the MCP connection.
- If a safe read reports `blocked: true`, cite its reason without retrying
  through another access path.
- If a tool returns an error, report the operation and sanitized error. Do not
  paste potentially sensitive paths or values unnecessarily.
- If available context is insufficient, state the limitation and request a
  synthetic, redacted, or explicitly approved alternative from the user.

## Common Workflows

### Explore an unfamiliar repository

Run `policy.explain`, `repo.scan_risks`, and `repo.list_files`. Search for entry
points with `repo.search_safe`, then read only the relevant allowed files with
`repo.read_file_safe`.

### Review code

Use `repo.search_safe` to find affected symbols and tests. Read the relevant
files safely, ground findings in the returned content, and mention when blocked
or redacted context limits confidence.

### Audit repository risk

Run `repo.scan_risks` and summarize the risk level, scanned-file count,
blocked-file count, and redaction counts by type. Never report detected values.

## Tool Reference

| Tool | Use |
| --- | --- |
| `policy.explain` | Inspect the active policy. |
| `repo.scan_risks` | Summarize blocked files and redactable patterns. |
| `repo.list_files` | Discover policy-allowed text files. |
| `repo.search_safe` | Search allowed files and receive redacted snippets. |
| `repo.read_file_safe` | Read one allowed file with redaction applied. |
