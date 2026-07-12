# Security Policy

## Supported Versions

ContextLock is currently pre-1.0. Security fixes are applied to the latest
release and the `main` branch. After v1, the latest major release is supported;
older majors receive fixes only when explicitly announced.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| `main` | Yes |
| Older releases | No |

Node.js 22.13+ is supported. Users should run a currently maintained Node.js
release and update ContextLock promptly because secret-detection gaps and
filesystem boundary issues can have security impact.

## Reporting a Vulnerability

Do not report vulnerabilities in a public issue or discussion. Use GitHub's
private vulnerability reporting from the repository's **Security** tab. If that
option is unavailable, contact the repository owner privately through their
GitHub profile.

Include only synthetic or redacted examples. Never send a real credential,
private key, customer record, or proprietary repository content.

Helpful reports include:

- The affected version or commit.
- Reproduction steps using safe test data.
- The security impact and expected behavior.
- A suggested fix, if available.

You should receive an acknowledgment within seven days. Please allow time for a
fix and coordinated release before publishing details.
