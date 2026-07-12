import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isBlocked, loadPolicy, toProjectPath } from "./policy.js";
import type { ContextLockPolicy, RedactionFinding, SafeReadResult, ScanSummary } from "./types.js";

type PatternRule = {
  key: keyof ContextLockPolicy["redact"];
  label: string;
  pattern: RegExp;
  replacement: string;
};

const REDACTION_RULES: PatternRule[] = [
  {
    key: "privateKeys",
    label: "private_key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED:PRIVATE_KEY]"
  },
  {
    key: "databaseUrls",
    label: "database_url",
    pattern: /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"'`<>]+/gi,
    replacement: "[REDACTED:DATABASE_URL]"
  },
  {
    key: "jwt",
    label: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: "[REDACTED:JWT]"
  },
  {
    key: "webhooks",
    label: "webhook_url",
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+|https:\/\/discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9/_-]+/gi,
    replacement: "[REDACTED:WEBHOOK_URL]"
  },
  {
    key: "apiKeys",
    label: "api_key",
    pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g,
    replacement: "[REDACTED:API_KEY]"
  },
  {
    key: "emails",
    label: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[REDACTED:EMAIL]"
  }
];

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cs",
  ".css",
  ".env",
  ".go",
  ".gradle",
  ".graphql",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".md",
  ".mjs",
  ".php",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);

export function redactContent(content: string, policy: ContextLockPolicy): { content: string; findings: RedactionFinding[] } {
  let redacted = content;
  const findings = new Map<string, number>();

  for (const rule of REDACTION_RULES) {
    if (!policy.redact[rule.key]) continue;

    let count = 0;
    redacted = redacted.replace(rule.pattern, () => {
      count += 1;
      return rule.replacement;
    });

    if (count > 0) {
      findings.set(rule.label, (findings.get(rule.label) ?? 0) + count);
    }
  }

  return {
    content: redacted,
    findings: [...findings.entries()].map(([type, count]) => ({ type, count }))
  };
}

export function listFiles(root: string, policy = loadPolicy(root)): string[] {
  const output: string[] = [];
  walk(resolve(root), resolve(root), policy, output);
  return output.sort();
}

export function readFileSafe(root: string, path: string, policy = loadPolicy(root)): SafeReadResult {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, path);

  if (!absolutePath.startsWith(absoluteRoot)) {
    return { path, blocked: true, redactions: [], reason: "Path escapes project root" };
  }

  const projectPath = toProjectPath(absoluteRoot, absolutePath);
  if (isBlocked(projectPath, policy)) {
    return { path: projectPath, blocked: true, redactions: [], reason: "Blocked by policy" };
  }

  const raw = readFileSync(absolutePath);
  if (raw.includes(0)) {
    return { path: projectPath, blocked: true, redactions: [], reason: "Binary file" };
  }

  const { content, findings } = redactContent(raw.toString("utf8"), policy);
  return { path: projectPath, blocked: false, content, redactions: findings };
}

export function searchSafe(root: string, query: string, policy = loadPolicy(root)): SafeReadResult[] {
  const lowerQuery = query.toLowerCase();
  return listFiles(root, policy)
    .map((file) => readFileSafe(root, file, policy))
    .filter((result) => !result.blocked && result.content?.toLowerCase().includes(lowerQuery))
    .map((result) => ({
      ...result,
      content: snippet(result.content ?? "", lowerQuery)
    }));
}

export function scanRisks(root: string, policy = loadPolicy(root)): ScanSummary {
  const absoluteRoot = resolve(root);
  const blockedFiles: string[] = [];
  const redactions = new Map<string, number>();
  let filesScanned = 0;

  for (const file of collectAllFiles(absoluteRoot, absoluteRoot, policy)) {
    const projectPath = toProjectPath(absoluteRoot, file);
    if (isBlocked(projectPath, policy)) {
      blockedFiles.push(projectPath);
      continue;
    }

    if (!isLikelyTextFile(file)) continue;

    filesScanned += 1;
    const raw = readFileSync(file);
    if (raw.includes(0)) continue;

    for (const finding of redactContent(raw.toString("utf8"), policy).findings) {
      redactions.set(finding.type, (redactions.get(finding.type) ?? 0) + finding.count);
    }
  }

  const totalRedactions = [...redactions.values()].reduce((sum, count) => sum + count, 0);
  const riskLevel = blockedFiles.length > 10 || totalRedactions > 10 ? "high" : blockedFiles.length || totalRedactions ? "medium" : "low";

  return {
    root: absoluteRoot,
    filesScanned,
    blockedFiles: blockedFiles.sort(),
    redactions: [...redactions.entries()].map(([type, count]) => ({ type, count })),
    riskLevel
  };
}

function walk(root: string, current: string, policy: ContextLockPolicy, output: string[]): void {
  for (const entry of readdirSync(current)) {
    const absolutePath = join(current, entry);
    const projectPath = toProjectPath(root, absolutePath);

    if (isBlocked(projectPath, policy)) continue;

    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walk(root, absolutePath, policy, output);
    } else if (stat.isFile() && isLikelyTextFile(absolutePath)) {
      output.push(projectPath);
    }
  }
}

function collectAllFiles(root: string, current: string, policy: ContextLockPolicy): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(current)) {
    const absolutePath = join(current, entry);
    const projectPath = toProjectPath(root, absolutePath);
    const stat = statSync(absolutePath);

    if (isBlocked(projectPath, policy)) {
      output.push(absolutePath);
      continue;
    }

    if (stat.isDirectory()) {
      output.push(...collectAllFiles(root, absolutePath, policy));
    } else if (stat.isFile()) {
      output.push(absolutePath);
    }
  }
  return output;
}

function isLikelyTextFile(path: string): boolean {
  const lowered = path.toLowerCase();
  if (lowered.endsWith("dockerfile") || lowered.endsWith("makefile")) return true;
  const dot = lowered.lastIndexOf(".");
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(lowered.slice(dot));
}

function snippet(content: string, lowerQuery: string): string {
  const lowerContent = content.toLowerCase();
  const index = lowerContent.indexOf(lowerQuery);
  if (index === -1) return content.slice(0, 800);
  const start = Math.max(0, index - 280);
  const end = Math.min(content.length, index + lowerQuery.length + 520);
  return content.slice(start, end);
}
