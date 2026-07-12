import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import picomatch from "picomatch";
import type { ContextLockPolicy } from "./types.js";

export const DEFAULT_POLICY: ContextLockPolicy = {
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
  if (!existsSync(configPath)) {
    return DEFAULT_POLICY;
  }

  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Partial<ContextLockPolicy>;
  return {
    blockedPatterns: parsed.blockedPatterns ?? DEFAULT_POLICY.blockedPatterns,
    redact: {
      ...DEFAULT_POLICY.redact,
      ...(parsed.redact ?? {})
    }
  };
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
