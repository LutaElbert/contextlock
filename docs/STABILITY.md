# Stability Policy

ContextLock 1.x is the stable CLI and MCP contract line. This document defines
the supported contracts, compatibility policy, and known limitations for stable
releases.

## Supported Runtime

- Node.js 22.13 or newer is required.
- CI verifies Node.js 22.13 and 24.
- The npm package is CLI-only. JavaScript and TypeScript imports are not a
  supported public API; the package `exports` map is intentionally empty.

## Stable Contracts

The CLI command names, documented flags, exit status behavior, generated config
shape, redaction placeholder format, and the five documented MCP tool names and
result shapes are stable v1 contracts. Incompatible changes to these contracts
require a new major version and will be called out in the changelog.

`schemaVersion` is the version marker for configuration and structured command
or MCP output. Config files require version `1` and reject unsupported versions
or unknown fields. Scan, policy, collection, and error responses emit version
`1` so consumers can validate the contract.

## Configuration Semantics

`contextlock.config.json` is loaded from the effective project root, which is
the CLI process working directory (`cwd`). Relative paths and policy matching
are rooted there. Start the CLI or MCP server with the intended repository as
its `cwd`; ContextLock does not discover a parent Git repository automatically.

Configuration is additive and cannot weaken baseline protection.
`blockedPatterns` adds unique entries to the defaults. The `redact` object can
enable redactors that are off by default, while `false` cannot disable a
baseline redactor. Invalid, unknown, unsupported, or symlinked configs fail
closed with an actionable error.

## Known Limitations

- Pattern-based detection cannot guarantee that every secret is found.
- Only likely text files and documented secret formats are scanned.
- Symlinks are rejected, reads are confined to the working-directory boundary,
  and traversal and file-size limits apply.
- ContextLock reduces accidental disclosure; it is not an authorization system,
  sandbox, malware scanner, or substitute for credential rotation.

## Semantic Versioning

Incompatible changes to stable contracts require a major release. Additive
fields and capabilities may ship in minor releases, and compatible fixes in
patch releases. Prereleases use SemVer suffixes and publish to npm under the
`next` dist-tag.

## Release Checklist

- Validate `schemaVersion: 1` on all promised structured surfaces.
- Test CLI commands, flags, exit codes, MCP names, and result shapes.
- Validate configuration with actionable errors and migration guidance.
- Recheck filesystem and symlink behavior.
- Review security posture and supported-version policy.
- Pass unit, CLI, MCP, package-consumer, and supported-Node CI suites.
- Verify package contents, provenance publishing, prerelease, and retry paths.
- Publish migration notes for any changed stable contracts.
