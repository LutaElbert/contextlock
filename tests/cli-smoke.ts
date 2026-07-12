import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist/cli.js");
const fixture = mkdtempSync(path.join(tmpdir(), "contextlock-cli-"));

try {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(run(["--version"]).stdout.trim(), packageJson.version);

  writeFileSync(path.join(fixture, "README.md"), "safe fixture\n");
  const low = run(["scan", "--fail-on", "medium"], fixture);
  assert.equal(low.status, 0);
  assert.equal(JSON.parse(low.stdout).riskLevel, "low");

  writeFileSync(path.join(fixture, ".env"), "SECRET=value\n");
  assert.equal(run(["scan", "--fail-on", "never"], fixture).status, 0);
  assert.equal(run(["scan", "--fail-on", "medium"], fixture).status, 1);
  assert.equal(run(["scan", "--fail-on", "high"], fixture).status, 0);
  assert.equal(run(["report", "--fail-on", "medium"], fixture).status, 1);

  const config = JSON.parse(run(["mcp-config", "--cwd", fixture]).stdout);
  assert.deepEqual(config.mcpServers.contextlock, {
    command: "npx",
    args: ["--yes", "contextlock@1", "mcp"],
    cwd: fixture
  });

  writeFileSync(path.join(fixture, "contextlock.config.json"), "not json\n");
  const failure = run(["scan"], fixture);
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, "");
  assert.ok(failure.stderr.length > 0);

  const invalidThreshold = run(["report", "--fail-on", "critical"], fixture);
  assert.equal(invalidThreshold.status, 1);
  assert.equal(invalidThreshold.stdout, "");
  assert.match(invalidThreshold.stderr, /never, medium, high/);

  console.log("CLI smoke test passed.");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

function run(args: string[], cwd = root) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  return result;
}
