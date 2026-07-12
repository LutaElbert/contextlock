import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_POLICY, loadPolicy } from "../src/policy.js";

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
