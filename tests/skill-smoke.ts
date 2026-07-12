import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const skill = readFileSync(new URL("../skills/contextlock/SKILL.md", import.meta.url), "utf8");
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);

assert.ok(frontmatter, "SKILL.md must begin with YAML frontmatter");
assert.match(frontmatter[1], /^name: contextlock$/m);
assert.match(frontmatter[1], /^description: .+$/m);
assert.match(frontmatter[1], /^license: Apache-2\.0$/m);

for (const tool of [
  "policy.explain",
  "repo.scan_risks",
  "repo.list_files",
  "repo.search_safe",
  "repo.read_file_safe"
]) {
  assert.ok(skill.includes(`\`${tool}\``), `SKILL.md must document ${tool}`);
}

assert.match(skill, /Do not bypass ContextLock/);
assert.match(skill, /Do not claim that a low risk level proves/);

console.log("ContextLock skill smoke test passed.");
