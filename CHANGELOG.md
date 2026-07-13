# Changelog

All notable changes to ContextLock will be documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-07-13

### Added

- `contextlock doctor` for inspecting the active project setup, config path,
  policy loading, and runtime readiness.
- `contextlock why <path>` for explaining why a file is allowed or blocked.
- `contextlock test-policy` for checking representative policy behavior before
  trusting a project setup.
- Project presets for Android, Node, Python, and mobile AI repositories.

### Changed

- Strengthened default blocking for mobile, build, generated, local model,
  database, screenshot, capture, and keystore artifacts.
- Improved safe file listing so MCP agents only see readable, policy-allowed
  files.
- Expanded secret redaction coverage for common API keys, tokens, passwords,
  credentials, and structured JSON/YAML assignments.
- Updated documentation around diagnostics, MCP usage, presets, and safety
  boundaries.

### Security

- Policy matching is now easier to verify and explain through CLI diagnostics.
- Case-insensitive path matching better protects uppercase variants of blocked
  files and extensions.

## [1.0.0] - 2026-07-12

### Added

- Release governance, stability documentation, and package-consumer testing.
- CI coverage for the minimum supported Node.js 22.13 release and Node.js 24.
- Stable CLI and MCP contracts for the first production-ready ContextLock
  release.
- Hardened filesystem handling for path traversal, symlinks, bounded reads, and
  repository-root confinement.
- Strict additive policy configuration with `schemaVersion: 1` validation.
- Broader high-confidence secret detection and safe redaction placeholders.

### Changed

- The npm package is now treated as CLI-only, with no supported JavaScript or
  TypeScript import API.
- Release publishing now runs through the guarded GitHub Release workflow after
  a version-bump pull request is merged.

### Security

- Config files fail closed when unknown, invalid, unsupported, or symlinked.
- Baseline blocked paths and baseline redactors cannot be disabled by project
  configuration.

## [0.1.0] - 2026-07-12

Initial prerelease implementation of the ContextLock CLI and MCP server.
