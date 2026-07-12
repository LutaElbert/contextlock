import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_POLICY } from "../src/policy.js";
import { MAX_FILE_BYTES, listFiles, readFileSafe, redactContent, scanRisks, searchSafe } from "../src/scanner.js";

function fixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "contextlock-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("rejects absolute, NUL, parent, sibling-prefix, and symlink paths", () => {
  const { root, cleanup } = fixture();
  const sibling = `${root}-outside`;
  try {
    mkdirSync(sibling); writeFileSync(join(sibling, "secret.txt"), "outside");
    writeFileSync(join(root, "ok.txt"), "inside");
    symlinkSync(join(sibling, "secret.txt"), join(root, "file-link.txt"));
    symlinkSync(sibling, join(root, "dir-link"), "dir");
    for (const path of [join(root, "ok.txt"), "bad\0name", "../secret.txt", `../${sibling.split("/").pop()}/secret.txt`, "file-link.txt", "dir-link/secret.txt"]) {
      assert.equal(readFileSafe(root, path).blocked, true, path);
    }
    assert.deepEqual(listFiles(root), ["ok.txt"]);
  } finally { cleanup(); rmSync(sibling, { recursive: true, force: true }); }
});

test("blocks policy files, binary files, large files, and non-regular files", () => {
  const { root, cleanup } = fixture();
  try {
    writeFileSync(join(root, ".env"), "TOKEN=secret");
    writeFileSync(join(root, "binary.txt"), Buffer.from([65, 0, 66]));
    writeFileSync(join(root, "large.txt"), Buffer.alloc(MAX_FILE_BYTES + 1, 65));
    mkdirSync(join(root, "folder"));
    assert.match(readFileSafe(root, ".env").reason ?? "", /policy/i);
    assert.match(readFileSafe(root, "binary.txt").reason ?? "", /binary/i);
    assert.match(readFileSafe(root, "large.txt").reason ?? "", /exceeds/i);
    assert.match(readFileSafe(root, "folder").reason ?? "", /regular/i);
  } finally { cleanup(); }
});

test("redacts high-confidence token, authorization, and secret assignment classes", () => {
  const npmToken = ["npm", "abcdefghijklmnopqrstuvwxyz1234567890"].join("_");
  const gitLabToken = ["glpat", "abcdefghijklmnopQRST"].join("-");
  const stripeToken = ["sk", "live", "abcdefghijklmnopqrstuv"].join("_");
  const bearerToken = ["Bearer", "abcdefghijklmnopqrstuvwx"].join(" ");
  const source = [
    npmToken,
    gitLabToken,
    stripeToken,
    "Authorization: BearerTokenValue1234567890",
    bearerToken,
    "client_secret = 'abcdefghijklmnopQRST'",
    "password=placeholder",
    "api_key=short"
  ].join("\n");
  const result = redactContent(source, DEFAULT_POLICY);
  assert.ok(!result.content.includes("npm_"));
  assert.ok(!result.content.includes("glpat-"));
  assert.ok(!result.content.includes("sk_live_"));
  assert.equal(result.findings.find((item) => item.type === "api_key")?.count, 3);
  assert.equal(result.findings.find((item) => item.type === "authorization")?.count, 2);
  assert.equal(result.findings.find((item) => item.type === "secret_assignment")?.count, 1);
  assert.match(result.content, /password=placeholder/);
  assert.match(result.content, /api_key=short/);
});

test("list, search, and scan are deterministic, redacted, and root-sanitized", () => {
  const { root, cleanup } = fixture();
  try {
    mkdirSync(join(root, "src"));
    const npmToken = ["npm", "abcdefghijklmnopqrstuvwxyz1234567890"].join("_");
    writeFileSync(join(root, "z.txt"), `needle ${npmToken}`);
    writeFileSync(join(root, "src", "a.ts"), "export const value = 'needle';");
    writeFileSync(join(root, ".env"), "password=abcdefghijklmnop");
    assert.deepEqual(listFiles(root), ["src/a.ts", "z.txt"]);
    const results = searchSafe(root, "needle");
    assert.deepEqual(results.map((item) => item.path), ["src/a.ts", "z.txt"]);
    assert.ok(!results[1].content?.includes("npm_"));
    const scan = scanRisks(root);
    assert.equal(scan.root, ".");
    assert.deepEqual(scan.blockedFiles, [".env"]);
    assert.equal(scan.filesScanned, 2);
    assert.equal(scan.traversal?.truncated, false);
  } finally { cleanup(); }
});

test("reports deterministic depth truncation", () => {
  const { root, cleanup } = fixture();
  try {
    let current = root;
    for (let index = 0; index < 35; index += 1) { current = join(current, "d"); mkdirSync(current); }
    writeFileSync(join(current, "hidden.txt"), "needle");
    const scan = scanRisks(root);
    assert.equal(scan.traversal?.truncated, true);
    assert.deepEqual(scan.traversal?.reasons, ["depth"]);
  } finally { cleanup(); }
});
