# Changelog

All notable changes to ContextLock will be documented here. The project follows
[Semantic Versioning](https://semver.org/).

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
