# Contributing to ContextLock

Thanks for helping make AI-assisted development safer. Contributions of code,
tests, documentation, policy rules, and reproducible bug reports are welcome.

## Before You Start

- Search existing issues and discussions before opening a new one.
- Open an issue before making a large or behavior-changing contribution.
- Never include real credentials, private keys, customer data, or proprietary
  source code in an issue, test fixture, commit, or pull request.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Local Setup

ContextLock requires Node.js 20+ and pnpm 11.

```bash
pnpm install
pnpm typecheck
pnpm test:mcp
```

Run the CLI during development with:

```bash
pnpm dev -- scan
pnpm dev -- mcp
```

## Making a Change

1. Fork the repository and create a focused branch.
2. Keep changes small and consistent with the existing TypeScript style.
3. Add or update tests for behavior changes.
4. Run `pnpm typecheck` and `pnpm test:mcp`.
5. Open a pull request using the provided template.

By submitting a contribution, you agree that it is licensed under the
project's Apache License 2.0.

## Review

Maintainers may request changes for correctness, security, scope, or
maintainability. A contribution can be declined even when it is technically
valid if it does not fit the current project direction.
