import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist/cli.js"), "mcp"],
  cwd: root
});
const client = new Client({ name: "contextlock-smoke-test", version: "0.1.0" });

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map(({ name }) => name).sort(),
    [
      "policy.explain",
      "repo.list_files",
      "repo.read_file_safe",
      "repo.scan_risks",
      "repo.search_safe"
    ]
  );

  const policy = parseTextResult(
    await client.callTool({ name: "policy.explain", arguments: {} })
  );
  assert.ok(Array.isArray(policy.blockedPatterns));
  assert.ok(policy.blockedPatterns.includes(".env"));

  const listing = parseTextResult(
    await client.callTool({ name: "repo.list_files", arguments: { limit: 10 } })
  );
  assert.ok(Array.isArray(listing.files));
  assert.ok(listing.files.includes("README.md"));

  const read = parseTextResult(
    await client.callTool({ name: "repo.read_file_safe", arguments: { path: "README.md" } })
  );
  assert.equal(read.path, "README.md");
  assert.match(read.content, /# ContextLock/);

  console.log(`MCP smoke test passed (${tools.length} tools discovered).`);
} finally {
  await client.close();
}

function parseTextResult(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, any> {
  const item = result.content.find((content) => content.type === "text");
  assert.ok(item && item.type === "text", "Expected an MCP text response");
  return JSON.parse(item.text);
}
