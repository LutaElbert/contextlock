import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadPolicy } from "./policy.js";
import { listFiles, readFileSafe, scanRisks, searchSafe } from "./scanner.js";
import { VERSION } from "./version.js";

const DEFAULT_FILE_LIMIT = 250;
const SEARCH_LIMIT = 20;
const MAX_PATH_LENGTH = 1024;
const MAX_QUERY_LENGTH = 256;

export async function startMcpServer(root = process.cwd()): Promise<void> {
  const server = new McpServer({
    name: "contextlock",
    version: VERSION
  });

  server.tool(
    "repo.list_files",
    "List policy-allowed text files in the current project.",
    {
      limit: z.number().int().positive().max(1000).optional()
    },
    async ({ limit }) => safeToolCall(() => {
      const files = listFiles(root);
      const requestedLimit = limit ?? DEFAULT_FILE_LIMIT;
      return collectionContent("files", files, requestedLimit);
    })
  );

  server.tool(
    "repo.read_file_safe",
    "Read one file after block rules and redaction rules are applied.",
    {
      path: z.string().min(1).max(MAX_PATH_LENGTH)
    },
    async ({ path }) => safeToolCall(() => readFileSafe(root, path))
  );

  server.tool(
    "repo.search_safe",
    "Search allowed project files and return redacted snippets.",
    {
      query: z.string().min(1).max(MAX_QUERY_LENGTH)
    },
    async ({ query }) => safeToolCall(() => {
      const results = searchSafe(root, query);
      return collectionContent("results", results, SEARCH_LIMIT);
    })
  );

  server.tool(
    "repo.scan_risks",
    "Scan the project for blocked files and redactable secrets.",
    {},
    async () => safeToolCall(() => scanRisks(root))
  );

  server.tool(
    "policy.explain",
    "Show active ContextLock block and redaction policy.",
    {},
    async () => safeToolCall(() => loadPolicy(root))
  );

  await server.connect(new StdioServerTransport());
}

function jsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function collectionContent<T>(key: "files" | "results", values: T[], limit: number) {
  return {
    schemaVersion: 1,
    [key]: values.slice(0, limit),
    total: values.length,
    truncated: values.length > limit
  };
}

async function safeToolCall(operation: () => unknown | Promise<unknown>) {
  try {
    return jsonContent(await operation());
  } catch {
    return {
      ...jsonContent({
        schemaVersion: 1,
        error: {
          code: "TOOL_ERROR",
          message: "Tool execution failed"
        }
      }),
      isError: true
    };
  }
}
