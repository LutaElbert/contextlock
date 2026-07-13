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
    mkdirSync(join(root, "build", "generated"), { recursive: true });
    mkdirSync(join(root, "app", "build", "outputs"), { recursive: true });
    writeFileSync(join(root, ".env"), "TOKEN=secret");
    writeFileSync(join(root, "build", "generated", "source.ts"), "generated");
    writeFileSync(join(root, "app", "build", "outputs", "app-release.apk"), "apk");
    writeFileSync(join(root, "binary.txt"), Buffer.from([65, 0, 66]));
    writeFileSync(join(root, "large.txt"), Buffer.alloc(MAX_FILE_BYTES + 1, 65));
    mkdirSync(join(root, "folder"));
    assert.match(readFileSafe(root, ".env").reason ?? "", /policy/i);
    assert.match(readFileSafe(root, "build/generated/source.ts").reason ?? "", /policy/i);
    assert.match(readFileSafe(root, "app/build/outputs/app-release.apk").reason ?? "", /policy/i);
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

test("redacts prefixed, generic, JSON, and YAML secret assignments but preserves placeholders", () => {
  const leakedValues = [
    "gemini-real-value-1234567890",
    "openai-real-value-1234567890",
    "access-real-value-1234567890",
    "generic-token-value-1234567890",
    "generic-secret-value-1234567890",
    "generic-password-value-1234567890",
    "credential-value-1234567890"
  ];
  const source = [
    `GEMINI_API_KEY=${leakedValues[0]}`,
    `OPENAI_API_KEY='${leakedValues[1]}'`,
    `FOO_ACCESS_TOKEN=${leakedValues[2]}`,
    `TOKEN=${leakedValues[3]}`,
    `"SECRET": "${leakedValues[4]}"`,
    `password: ${leakedValues[5]}`,
    `'service_credential': '${leakedValues[6]}'`,
    "API_KEY=placeholder",
    "TOKEN=sample",
    "SECRET=changeme",
    "PASSWORD=false",
    '"CREDENTIAL": null',
    "token_count=1234567890",
    "password_policy=minimum-eight-characters"
  ].join("\n");

  const result = redactContent(source, DEFAULT_POLICY);
  for (const value of leakedValues) assert.ok(!result.content.includes(value), value);
  assert.equal(result.findings.find((item) => item.type === "secret_assignment")?.count, leakedValues.length);
  assert.match(result.content, /OPENAI_API_KEY='\[REDACTED:SECRET_ASSIGNMENT\]'/);
  assert.match(result.content, /"SECRET": "\[REDACTED:SECRET_ASSIGNMENT\]"/);
  assert.match(result.content, /'service_credential': '\[REDACTED:SECRET_ASSIGNMENT\]'/);
  for (const safeLine of ["API_KEY=placeholder", "TOKEN=sample", "SECRET=changeme", "PASSWORD=false", '"CREDENTIAL": null', "token_count=1234567890", "password_policy=minimum-eight-characters"]) {
    assert.ok(result.content.includes(safeLine), safeLine);
  }
});

test("safe read, search, and risk scan never expose structured secret values", () => {
  const { root, cleanup } = fixture();
  try {
    const values = ["gemini-value-1234567890", "generic-token-1234567890", "json-secret-1234567890"];
    writeFileSync(join(root, "config.ts"), `export const GEMINI_API_KEY = "${values[0]}";\nexport const TOKEN = '${values[1]}';\n`);
    writeFileSync(join(root, "settings.json"), `{"OPENAI_API_KEY":"${values[2]}"}\n`);

    const read = readFileSafe(root, "config.ts");
    assert.equal(read.blocked, false);
    assert.equal(read.redactions.find((item) => item.type === "secret_assignment")?.count, 2);
    for (const value of values) assert.ok(!read.content?.includes(value), value);

    const search = searchSafe(root, "GEMINI_API_KEY");
    assert.equal(search.length, 1);
    for (const value of values) assert.ok(!search[0].content?.includes(value), value);

    const scan = scanRisks(root);
    assert.equal(scan.filesScanned, 2);
    assert.equal(scan.redactions.find((item) => item.type === "secret_assignment")?.count, 3);
    assert.equal(scan.riskLevel, "medium");
  } finally { cleanup(); }
});

test("listing includes readable extensionless text and excludes unreadable candidates", () => {
  const { root, cleanup } = fixture();
  try {
    writeFileSync(join(root, "NOTICE"), "extensionless needle text");
    writeFileSync(join(root, "binary.txt"), Buffer.from([65, 0, 66]));
    writeFileSync(join(root, "large.txt"), Buffer.alloc(MAX_FILE_BYTES + 1, 65));
    writeFileSync(join(root, "binary-extensionless"), Buffer.from([65, 0, 66]));
    symlinkSync(join(root, "NOTICE"), join(root, "notice-link"));

    assert.deepEqual(listFiles(root), ["NOTICE"]);
    assert.deepEqual(searchSafe(root, "needle").map((item) => item.path), ["NOTICE"]);
    assert.equal(readFileSafe(root, "NOTICE").blocked, false);
    assert.equal(readFileSafe(root, "binary-extensionless").blocked, true);
  } finally { cleanup(); }
});

test("list, search, and scan are deterministic, redacted, and root-sanitized", () => {
  const { root, cleanup } = fixture();
  try {
    mkdirSync(join(root, "src"));
    const npmToken = ["npm", "abcdefghijklmnopqrstuvwxyz1234567890"].join("_");
    writeFileSync(join(root, "z.txt"), `needle ${npmToken}`);
    writeFileSync(join(root, "src", "a.ts"), "export const value = 'needle';");
    const envPassword = ["password", "abcdefghijklmnop"].join("=");
    writeFileSync(join(root, ".env"), envPassword);
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
