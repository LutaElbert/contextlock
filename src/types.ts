export type RedactionConfig = {
  apiKeys: boolean;
  jwt: boolean;
  databaseUrls: boolean;
  privateKeys: boolean;
  webhooks: boolean;
  emails: boolean;
};

export type ContextLockPolicy = {
  schemaVersion: 1;
  blockedPatterns: string[];
  redact: RedactionConfig;
};

export type RedactionFinding = {
  type: string;
  count: number;
};

export type SafeReadResult = {
  path: string;
  blocked: boolean;
  content?: string;
  redactions: RedactionFinding[];
  reason?: string;
};

export type ScanSummary = {
  schemaVersion: 1;
  root: string;
  filesScanned: number;
  blockedFiles: string[];
  redactions: RedactionFinding[];
  riskLevel: "low" | "medium" | "high";
  traversal?: TraversalMetadata;
};

export type TraversalMetadata = {
  truncated: boolean;
  filesVisited: number;
  maxFiles: number;
  maxDepth: number;
  reasons: Array<"depth" | "files">;
};
