import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadPolicy } from "./policy.js";
import { listFiles, readFileSafe, scanRisks, searchSafe } from "./scanner.js";

export async function startMcpServer(root = process.cwd()): Promise<void> {
  const server = new McpServer({
    name: "contextlock",
    version: "0.1.0"
  });

  server.tool(
    "repo.list_files",
    "List policy-allowed text files in the current project.",
    {
      limit: z.number().int().positive().max(1000).optional()
    },
    async ({ limit }) => jsonContent({ files: listFiles(root).slice(0, limit ?? 250) })
  );

  server.tool(
    "repo.read_file_safe",
    "Read one file after block rules and redaction rules are applied.",
    {
      path: z.string().min(1)
    },
    async ({ path }) => jsonContent(readFileSafe(root, path))
  );

  server.tool(
    "repo.search_safe",
    "Search allowed project files and return redacted snippets.",
    {
      query: z.string().min(1)
    },
    async ({ query }) => jsonContent({ results: searchSafe(root, query).slice(0, 20) })
  );

  server.tool(
    "repo.scan_risks",
    "Scan the project for blocked files and redactable secrets.",
    {},
    async () => jsonContent(scanRisks(root))
  );

  server.tool(
    "policy.explain",
    "Show active ContextLock block and redaction policy.",
    {},
    async () => jsonContent(loadPolicy(root))
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
