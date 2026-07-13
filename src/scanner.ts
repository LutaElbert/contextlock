import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isBlocked, loadPolicy, toProjectPath } from "./policy.js";
import type { ContextLockPolicy, RedactionFinding, SafeReadResult, ScanSummary } from "./types.js";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_TRAVERSAL_FILES = 10_000;
export const MAX_TRAVERSAL_DEPTH = 32;

type PatternRule = {
  key: keyof ContextLockPolicy["redact"];
  label: string;
  pattern: RegExp;
  replacement: string | ((...matches: string[]) => string);
};

const REDACTION_RULES: PatternRule[] = [
  { key: "privateKeys", label: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED:PRIVATE_KEY]" },
  { key: "databaseUrls", label: "database_url", pattern: /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"'`<>]+/gi, replacement: "[REDACTED:DATABASE_URL]" },
  { key: "jwt", label: "jwt", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: "[REDACTED:JWT]" },
  { key: "webhooks", label: "webhook_url", pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+|https:\/\/discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9/_-]+/gi, replacement: "[REDACTED:WEBHOOK_URL]" },
  {
    key: "apiKeys",
    label: "api_key",
    pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|rk_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{30,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g,
    replacement: "[REDACTED:API_KEY]"
  },
  {
    key: "apiKeys",
    label: "authorization",
    pattern: /\b(?:authorization\s*[:=]\s*|bearer\s+)(["']?)(?:[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,})\1/gi,
    replacement: "[REDACTED:AUTHORIZATION]"
  },
  {
    key: "apiKeys",
    label: "secret_assignment",
    pattern: /((?:["']?)(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|token|secret|password|passwd|credentials?)["']?\s*[:=]\s*)(["']?)(?!(?:true|false|null|undefined|changeme|change_me|example|sample|placeholder)(?:\2|\s|[,;\]}#]|$))(?=[A-Za-z0-9_./+@%:=!?$&*()-]{8,}\2(?:\s|[,;\]}#]|$))[A-Za-z0-9_./+@%:=!?$&*()-]+\2/gim,
    replacement: (_match, assignment, quote) => `${assignment}${quote}[REDACTED:SECRET_ASSIGNMENT]${quote}`
  },
  { key: "emails", label: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[REDACTED:EMAIL]" }
];

const TEXT_EXTENSIONS = new Set([".c", ".cc", ".conf", ".cs", ".css", ".env", ".go", ".gradle", ".graphql", ".html", ".java", ".js", ".json", ".jsx", ".kt", ".kts", ".md", ".mjs", ".php", ".properties", ".py", ".rb", ".rs", ".sh", ".sql", ".swift", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml"]);

export function redactContent(content: string, policy: ContextLockPolicy): { content: string; findings: RedactionFinding[] } {
  let redacted = content;
  const findings = new Map<string, number>();
  for (const rule of REDACTION_RULES) {
    if (!policy.redact[rule.key]) continue;
    let count = 0;
    redacted = redacted.replace(rule.pattern, (...matches) => {
      count += 1;
      return typeof rule.replacement === "function" ? rule.replacement(...matches) : rule.replacement;
    });
    if (count) findings.set(rule.label, (findings.get(rule.label) ?? 0) + count);
  }
  return { content: redacted, findings: [...findings.entries()].map(([type, count]) => ({ type, count })) };
}

export function listFiles(root: string, policy = loadPolicy(root)): string[] {
  const absoluteRoot = resolve(root);
  return traverse(absoluteRoot, policy, false).files
    .map((file) => readFileSafe(absoluteRoot, file.path, policy))
    .filter((result) => !result.blocked)
    .map((result) => result.path);
}

export function readFileSafe(root: string, path: string, policy = loadPolicy(root)): SafeReadResult {
  const rejected = validateProjectPath(root, path);
  if (rejected) return { path: safeDisplayPath(path), blocked: true, redactions: [], reason: rejected };
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, path);
  const projectPath = toProjectPath(absoluteRoot, absolutePath);
  if (isBlocked(projectPath, policy)) return { path: projectPath, blocked: true, redactions: [], reason: "Blocked by policy" };

  try {
    if (hasSymlinkComponent(absoluteRoot, absolutePath)) return { path: projectPath, blocked: true, redactions: [], reason: "Symlinks are not allowed" };
    const stat = lstatSync(absolutePath);
    if (!stat.isFile()) return { path: projectPath, blocked: true, redactions: [], reason: "Not a regular file" };
    if (stat.size > MAX_FILE_BYTES) return { path: projectPath, blocked: true, redactions: [], reason: `File exceeds ${MAX_FILE_BYTES} byte limit` };
    const raw = readRegularFileBounded(absolutePath);
    if (raw.includes(0)) return { path: projectPath, blocked: true, redactions: [], reason: "Binary file" };
    const { content, findings } = redactContent(raw.toString("utf8"), policy);
    return { path: projectPath, blocked: false, content, redactions: findings };
  } catch {
    return { path: projectPath, blocked: true, redactions: [], reason: "File is unavailable" };
  }
}

export function searchSafe(root: string, query: string, policy = loadPolicy(root)): SafeReadResult[] {
  const lowerQuery = query.toLowerCase();
  return listFiles(root, policy).map((file) => readFileSafe(root, file, policy))
    .filter((result) => !result.blocked && result.content?.toLowerCase().includes(lowerQuery))
    .map((result) => ({ ...result, content: snippet(result.content ?? "", lowerQuery) }));
}

export function scanRisks(root: string, policy = loadPolicy(root)): ScanSummary {
  const absoluteRoot = resolve(root);
  const traversal = traverse(absoluteRoot, policy, true);
  const blockedFiles = traversal.blocked.map((entry) => entry.path);
  const redactions = new Map<string, number>();
  let filesScanned = 0;
  for (const file of traversal.files) {
    const result = readFileSafe(absoluteRoot, file.path, policy);
    if (result.blocked) {
      if (!blockedFiles.includes(file.path)) blockedFiles.push(file.path);
      continue;
    }
    filesScanned += 1;
    for (const finding of result.redactions) redactions.set(finding.type, (redactions.get(finding.type) ?? 0) + finding.count);
  }
  const totalRedactions = [...redactions.values()].reduce((sum, count) => sum + count, 0);
  const riskLevel = blockedFiles.length > 10 || totalRedactions > 10 ? "high" : blockedFiles.length || totalRedactions ? "medium" : "low";
  return { schemaVersion: 1, root: ".", filesScanned, blockedFiles: blockedFiles.sort(), redactions: [...redactions.entries()].map(([type, count]) => ({ type, count })), riskLevel, traversal: { truncated: traversal.truncated, filesVisited: traversal.visited, maxFiles: MAX_TRAVERSAL_FILES, maxDepth: MAX_TRAVERSAL_DEPTH, reasons: [...traversal.reasons].sort() } };
}

type TraversedFile = { path: string; absolutePath: string };
function traverse(root: string, policy: ContextLockPolicy, includeBlocked: boolean): { files: TraversedFile[]; blocked: TraversedFile[]; visited: number; truncated: boolean; reasons: Set<"depth" | "files"> } {
  const files: TraversedFile[] = [];
  const blocked: TraversedFile[] = [];
  const reasons = new Set<"depth" | "files">();
  let visited = 0;
  function walk(current: string, depth: number): void {
    if (depth > MAX_TRAVERSAL_DEPTH) { reasons.add("depth"); return; }
    let entries: string[];
    try { entries = readdirSync(current).sort(); } catch { return; }
    for (const entry of entries) {
      if (visited >= MAX_TRAVERSAL_FILES) { reasons.add("files"); return; }
      visited += 1;
      const absolutePath = join(current, entry);
      const projectPath = toProjectPath(root, absolutePath);
      let stat;
      try { stat = lstatSync(absolutePath); } catch { continue; }
      if (stat.isSymbolicLink()) { if (includeBlocked) blocked.push({ path: projectPath, absolutePath }); continue; }
      if (isBlocked(projectPath, policy)) { if (includeBlocked) blocked.push({ path: projectPath, absolutePath }); continue; }
      if (stat.isDirectory()) walk(absolutePath, depth + 1);
      else if (stat.isFile() && (includeBlocked || isLikelyTextFile(absolutePath))) files.push({ path: projectPath, absolutePath });
    }
  }
  walk(root, 0);
  return { files, blocked, visited, truncated: reasons.size > 0, reasons };
}

function validateProjectPath(root: string, path: string): string | undefined {
  if (!path || path.includes("\0")) return "Invalid path";
  if (isAbsolute(path)) return "Absolute paths are not allowed";
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, path);
  const rel = relative(absoluteRoot, absolutePath);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return "Path escapes project root";
  return undefined;
}

function hasSymlinkComponent(root: string, target: string): boolean {
  const rel = relative(root, target);
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function safeDisplayPath(path: string): string { return path.includes("\0") ? path.replaceAll("\0", "\\0") : path; }
function readRegularFileBounded(path: string): Buffer {
  const descriptor = openSync(path, "r");
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error("Not a regular file");
    if (stat.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} byte limit`);
    const output = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < output.length) {
      const bytesRead = readSync(descriptor, output, offset, output.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (readSync(descriptor, Buffer.alloc(1), 0, 1, offset) > 0) throw new Error(`File exceeds ${MAX_FILE_BYTES} byte limit`);
    return output.subarray(0, offset);
  } finally {
    closeSync(descriptor);
  }
}
function isLikelyTextFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile" || name === "makefile") return true;
  const dot = name.lastIndexOf(".");
  if (dot === -1) return true;
  return TEXT_EXTENSIONS.has(name.slice(dot));
}
function snippet(content: string, lowerQuery: string): string { const index = content.toLowerCase().indexOf(lowerQuery); if (index === -1) return content.slice(0, 800); return content.slice(Math.max(0, index - 280), Math.min(content.length, index + lowerQuery.length + 520)); }
