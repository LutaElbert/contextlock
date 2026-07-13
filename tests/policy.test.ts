import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPolicy, DEFAULT_POLICY, explainPolicyForPath, loadPolicy } from "../src/policy.js";

function withTempDir(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "contextlock-policy-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeConfig(root: string, value: unknown): void {
  writeFileSync(join(root, "contextlock.config.json"), JSON.stringify(value));
}

test("loads a valid config by adding blocks and configurable redaction", () => {
  withTempDir((root) => {
    writeConfig(root, {
      schemaVersion: 1,
      blockedPatterns: ["private/**", ".env"],
      redact: { emails: true }
    });

    const policy = loadPolicy(root);
    assert.deepEqual(policy.blockedPatterns, [...DEFAULT_POLICY.blockedPatterns, "private/**"]);
    assert.equal(policy.redact.emails, true);
    assert.equal(policy.redact.apiKeys, true);
  });
});

test("rejects malformed JSON", () => {
  withTempDir((root) => {
    writeFileSync(join(root, "contextlock.config.json"), "{ nope");
    assert.throws(() => loadPolicy(root), /malformed JSON.*Fix or remove/);
  });
});

test("rejects invalid types, unknown keys, and unsupported versions", () => {
  for (const config of [
    { schemaVersion: 1, blockedPatterns: "**/secret" },
    { schemaVersion: 1, surprise: true },
    { schemaVersion: 2 }
  ]) {
    withTempDir((root) => {
      writeConfig(root, config);
      assert.throws(() => loadPolicy(root), /Invalid contextlock\.config\.json: is invalid/);
    });
  }
});

test("enforces blocked pattern array and string bounds", () => {
  for (const blockedPatterns of [
    Array.from({ length: 101 }, (_, index) => `secret-${index}`),
    ["x".repeat(257)],
    [""]
  ]) {
    withTempDir((root) => {
      writeConfig(root, { schemaVersion: 1, blockedPatterns });
      assert.throws(() => loadPolicy(root), /Invalid contextlock\.config\.json: is invalid/);
    });
  }
});

test("rejects symlink config files", () => {
  withTempDir((root) => {
    const target = join(root, "real-config.json");
    writeFileSync(target, JSON.stringify({ schemaVersion: 1 }));
    symlinkSync(target, join(root, "contextlock.config.json"));
    assert.throws(() => loadPolicy(root), /symbolic links are not allowed/);
  });
});

test("attempted weakening cannot remove baseline protections", () => {
  withTempDir((root) => {
    writeConfig(root, {
      schemaVersion: 1,
      blockedPatterns: [],
      redact: {
        apiKeys: false,
        jwt: false,
        databaseUrls: false,
        privateKeys: false,
        webhooks: false,
        emails: false
      }
    });

    const policy = loadPolicy(root);
    assert.deepEqual(policy.blockedPatterns, DEFAULT_POLICY.blockedPatterns);
    assert.deepEqual(policy.redact, DEFAULT_POLICY.redact);
  });
});

test("explains default and root-level generated path matches", () => {
  assert.deepEqual(explainPolicyForPath("src/index.ts", DEFAULT_POLICY), {
    schemaVersion: 1,
    path: "src/index.ts",
    blocked: false,
    reason: "Allowed by active policy"
  });

  const generated = explainPolicyForPath("build/generated/source.ts", DEFAULT_POLICY);
  assert.equal(generated.blocked, true);
  assert.equal(generated.matchedPattern, "**/build/**");

  const windowsPath = explainPolicyForPath("app\\.gradle\\cache.bin", DEFAULT_POLICY);
  assert.equal(windowsPath.blocked, true);
  assert.equal(windowsPath.path, "app/.gradle/cache.bin");
});

test("matches protected paths case-insensitively without blocking similar names", () => {
  for (const path of [
    ".ENV",
    "BUILD/generated/source.ts",
    "secrets/CERT.PEM",
    "release/APP.APK",
    "vendor/NODE_MODULES/package/index.js"
  ]) {
    assert.equal(explainPolicyForPath(path, DEFAULT_POLICY).blocked, true, path);
  }

  for (const path of [
    ".environment",
    "buildish/output.txt",
    "node_modules_backup/index.js",
    "cert.pem.example"
  ]) {
    assert.equal(explainPolicyForPath(path, DEFAULT_POLICY).blocked, false, path);
  }
});

test("blocks singular capture and screenshot artifacts conservatively", () => {
  for (const path of [
    "capture/frame.png",
    "debug/CAPTURE/frame.txt",
    "screenshot/home.jpg",
    "artifacts/SCREENSHOT/home.txt",
    "debug/capture.png",
    "debug/SCREENSHOT.WEBP"
  ]) {
    assert.equal(explainPolicyForPath(path, DEFAULT_POLICY).blocked, true, path);
  }

  for (const path of ["src/capture.ts", "src/screenshot.ts", "docs/capture-guide.md"]) {
    assert.equal(explainPolicyForPath(path, DEFAULT_POLICY).blocked, false, path);
  }
});

test("matches custom blocked patterns case-insensitively", () => {
  withTempDir((root) => {
    writeConfig(root, { schemaVersion: 1, blockedPatterns: ["private/**"] });
    assert.equal(explainPolicyForPath("PRIVATE/notes.txt", loadPolicy(root)).blocked, true);
  });
});

test("creates stronger project presets", () => {
  const mobile = createPolicy("mobile-ai");
  assert.ok(mobile.blockedPatterns.includes("**/*.safetensors"));
  assert.equal(explainPolicyForPath("models/weights.safetensors", mobile).blocked, true);

  const python = createPolicy("python");
  assert.equal(explainPolicyForPath(".venv/lib/python/site.py", python).blocked, true);
});
