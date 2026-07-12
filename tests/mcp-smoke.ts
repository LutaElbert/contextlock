import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import packageJson from "../package.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = mkdtempSync(path.join(tmpdir(), "contextlock-mcp-"));
writeFileSync(path.join(fixture, "README.md"), "# ContextLock fixture\nneedle\n");
writeFileSync(path.join(fixture, "second.txt"), "needle again\n");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist/cli.js"), "mcp"],
  cwd: fixture
});
const client = new Client({ name: "contextlock-smoke-test", version: packageJson.version });

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
  assert.equal(tools.length, 5);

  const readTool = tools.find(({ name }) => name === "repo.read_file_safe");
  const searchTool = tools.find(({ name }) => name === "repo.search_safe");
  assert.equal((readTool?.inputSchema.properties?.path as { maxLength?: number }).maxLength, 1024);
  assert.equal((searchTool?.inputSchema.properties?.query as { maxLength?: number }).maxLength, 256);

  const policy = parseTextResult(
    await client.callTool({ name: "policy.explain", arguments: {} })
  );
  assert.ok(Array.isArray(policy.blockedPatterns));
  assert.ok(policy.blockedPatterns.includes(".env"));

  const listing = parseTextResult(
    await client.callTool({ name: "repo.list_files", arguments: { limit: 1 } })
  );
  assert.ok(Array.isArray(listing.files));
  assert.equal(listing.files.length, 1);
  assert.equal(listing.total, 2);
  assert.equal(listing.truncated, true);

  const read = parseTextResult(
    await client.callTool({ name: "repo.read_file_safe", arguments: { path: "README.md" } })
  );
  assert.equal(read.path, "README.md");
  assert.match(read.content, /# ContextLock fixture/);

  const search = parseTextResult(
    await client.callTool({ name: "repo.search_safe", arguments: { query: "needle" } })
  );
  assert.equal(search.results.length, 2);
  assert.equal(search.total, 2);
  assert.equal(search.truncated, false);

  const scan = parseTextResult(
    await client.callTool({ name: "repo.scan_risks", arguments: {} })
  );
  assert.equal(scan.riskLevel, "low");

  writeFileSync(path.join(fixture, "contextlock.config.json"), "not json\n");
  const failedPolicy = await client.callTool({
    name: "policy.explain",
    arguments: {}
  });
  assert.equal(failedPolicy.isError, true);
  const error = parseTextResult(failedPolicy);
  assert.deepEqual(error, {
    schemaVersion: 1,
    error: { code: "TOOL_ERROR", message: "Tool execution failed" }
  });
  assert.equal(JSON.stringify(error).includes(fixture), false);

  const oversizedPath = await client.callTool({
    name: "repo.read_file_safe",
    arguments: { path: "x".repeat(1025) }
  });
  assert.equal(oversizedPath.isError, true);

  const oversizedQuery = await client.callTool({
    name: "repo.search_safe",
    arguments: { query: "x".repeat(257) }
  });
  assert.equal(oversizedQuery.isError, true);

  console.log(`MCP smoke test passed (${tools.length} tools discovered).`);
} finally {
  await client.close();
  rmSync(fixture, { recursive: true, force: true });
}

function parseTextResult(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, any> {
  const item = result.content.find((content) => content.type === "text");
  assert.ok(item && item.type === "text", "Expected an MCP text response");
  return JSON.parse(item.text);
}
