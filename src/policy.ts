import { lstatSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import picomatch from "picomatch";
import { z } from "zod";
import type { ContextLockPolicy } from "./types.js";

const MAX_BLOCKED_PATTERNS = 100;
const MAX_PATTERN_LENGTH = 256;

const configSchema = z.object({
  schemaVersion: z.literal(1),
  blockedPatterns: z.array(
    z.string().min(1).max(MAX_PATTERN_LENGTH)
  ).max(MAX_BLOCKED_PATTERNS).optional(),
  redact: z.object({
    apiKeys: z.boolean().optional(),
    jwt: z.boolean().optional(),
    databaseUrls: z.boolean().optional(),
    privateKeys: z.boolean().optional(),
    webhooks: z.boolean().optional(),
    emails: z.boolean().optional()
  }).strict().optional()
}).strict();

export const DEFAULT_POLICY: ContextLockPolicy = {
  schemaVersion: 1 as const,
  blockedPatterns: [
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
    "**/*.pem",
    "**/*.key",
    "**/id_rsa",
    "**/id_dsa",
    "**/credentials.json",
    "**/service-account*.json",
    "**/*.sqlite",
    "**/*.db",
    "**/*.dump",
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/.turbo/**"
  ],
  redact: {
    apiKeys: true,
    jwt: true,
    databaseUrls: true,
    privateKeys: true,
    webhooks: true,
    emails: false
  }
};

export function loadPolicy(root: string): ContextLockPolicy {
  const configPath = join(root, "contextlock.config.json");
  let stats;
  try {
    stats = lstatSync(configPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return DEFAULT_POLICY;
    }
    throw configError("could not inspect the file");
  }

  if (stats.isSymbolicLink()) {
    throw configError("symbolic links are not allowed");
  }
  if (!stats.isFile()) {
    throw configError("must be a regular file");
  }

  let input: unknown;
  try {
    input = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw configError("contains malformed JSON");
    }
    throw configError("could not be read");
  }

  const result = configSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 5).map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    });
    throw configError(`is invalid (${issues.join("; ")})`);
  }

  const additions = result.data.blockedPatterns ?? [];
  const requestedRedactions = result.data.redact ?? {};
  return {
    schemaVersion: 1,
    blockedPatterns: [...new Set([...DEFAULT_POLICY.blockedPatterns, ...additions])],
    redact: {
      apiKeys: DEFAULT_POLICY.redact.apiKeys || requestedRedactions.apiKeys === true,
      jwt: DEFAULT_POLICY.redact.jwt || requestedRedactions.jwt === true,
      databaseUrls: DEFAULT_POLICY.redact.databaseUrls || requestedRedactions.databaseUrls === true,
      privateKeys: DEFAULT_POLICY.redact.privateKeys || requestedRedactions.privateKeys === true,
      webhooks: DEFAULT_POLICY.redact.webhooks || requestedRedactions.webhooks === true,
      emails: DEFAULT_POLICY.redact.emails || requestedRedactions.emails === true
    }
  };
}

function configError(detail: string): Error {
  return new Error(`Invalid contextlock.config.json: ${detail}. Fix or remove the config file.`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function toProjectPath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).replaceAll("\\", "/");
}

export function isBlocked(projectPath: string, policy: ContextLockPolicy): boolean {
  const normalized = projectPath.replaceAll("\\", "/");
  return policy.blockedPatterns.some((pattern) =>
    picomatch.isMatch(normalized, pattern, { dot: true }) ||
    picomatch.isMatch(`/${normalized}`, pattern, { dot: true })
  );
}
