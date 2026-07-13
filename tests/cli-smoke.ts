import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

  const why = JSON.parse(run(["why", "build/generated/output.js"], fixture).stdout);
  assert.equal(why.blocked, true);
  assert.equal(why.matchedPattern, "**/build/**");

  for (const invalidPath of ["../outside.txt", path.resolve(fixture, "README.md")]) {
    const invalidWhy = JSON.parse(run(["why", invalidPath], fixture).stdout);
    assert.equal(invalidWhy.blocked, true);
    assert.match(invalidWhy.reason, /Absolute paths|escapes project root/);
  }

  const policyTest = JSON.parse(run(["test-policy"], fixture).stdout);
  assert.equal(policyTest.passed, true);
  assert.ok(policyTest.checks.length >= 5);

  writeFileSync(path.join(fixture, "contextlock.config.json"), JSON.stringify({
    schemaVersion: 1,
    blockedPatterns: ["src/**"]
  }));
  const restrictivePolicyTest = JSON.parse(run(["test-policy"], fixture).stdout);
  assert.equal(restrictivePolicyTest.passed, true);
  const allowedCheck = restrictivePolicyTest.checks.find((check: { path: string }) => check.path === "src/index.ts");
  assert.equal(allowedCheck.required, false);
  assert.equal(allowedCheck.passed, false);
  rmSync(path.join(fixture, "contextlock.config.json"));

  const doctor = JSON.parse(run(["doctor"], fixture).stdout);
  assert.equal(realpathSync(doctor.cwd), realpathSync(fixture));
  assert.equal(doctor.mcp.transport, "stdio");
  assert.equal(doctor.policy.sampleBlockedPath.blocked, true);

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

  const presetFixture = mkdtempSync(path.join(tmpdir(), "contextlock-cli-preset-"));
  try {
    const init = run(["init", "--mobile-ai"], presetFixture);
    assert.equal(init.status, 0);
    assert.match(init.stdout, /mobile-ai preset/);
    const policy = JSON.parse(readFileSync(path.join(presetFixture, "contextlock.config.json"), "utf8"));
    assert.ok(policy.blockedPatterns.includes("**/*.safetensors"));
  } finally {
    rmSync(presetFixture, { recursive: true, force: true });
  }

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
