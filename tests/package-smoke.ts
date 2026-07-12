import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "contextlock-package-"));
const expectedVersion = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;

try {
  const packOutput = execFileSync("pnpm", ["pack", "--pack-destination", temp], {
    cwd: root,
    encoding: "utf8"
  });
  const tarballName = packOutput.trim().split("\n").at(-1);
  assert.ok(tarballName, "pnpm pack did not report a tarball");
  const tarball = isAbsolute(tarballName) ? tarballName : join(temp, tarballName);

  const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  for (const required of [
    "package/package.json",
    "package/dist/cli.js",
    "package/README.md",
    "package/CHANGELOG.md",
    "package/SECURITY.md",
    "package/CONTRIBUTING.md",
    "package/docs/STABILITY.md"
  ]) {
    assert.ok(listing.includes(required), `tarball is missing ${required}`);
  }

  if (spawnSync("npm", ["--version"]).status === 0) {
    execFileSync("npm", ["init", "--yes"], { cwd: temp, stdio: "ignore" });
    execFileSync("npm", ["install", "--ignore-scripts", tarball], { cwd: temp, stdio: "ignore" });
  } else {
    execFileSync("pnpm", ["init"], { cwd: temp, stdio: "ignore" });
    execFileSync("pnpm", ["add", "--ignore-scripts", tarball], { cwd: temp, stdio: "ignore" });
  }

  const cli = join(temp, "node_modules", ".bin", "contextlock");
  assert.equal(execFileSync(cli, ["--version"], { encoding: "utf8" }).trim(), expectedVersion);
  assert.match(execFileSync(cli, ["--help"], { encoding: "utf8" }), /Local-first MCP safety layer/);

  const metadata = JSON.parse(
    readFileSync(join(temp, "node_modules", "contextlock", "package.json"), "utf8")
  ) as { exports?: unknown };
  assert.deepEqual(metadata.exports, {}, "package must remain explicitly CLI-only");
  console.log("package smoke passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
