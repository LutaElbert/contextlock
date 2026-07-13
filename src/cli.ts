#!/usr/bin/env node
import { existsSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createPolicy, explainPolicyForPath, loadPolicy, policyPresets } from "./policy.js";
import { readFileSafe, scanRisks } from "./scanner.js";
import { startMcpServer } from "./mcp.js";
import type { PolicyPreset, ScanSummary } from "./types.js";
import { VERSION } from "./version.js";

type FailOn = "never" | "medium" | "high";

const program = new Command();

program
  .name("contextlock")
  .description("Local-first MCP safety layer for AI coding agents.")
  .version(VERSION);

program
  .command("init")
  .description("Create contextlock.config.json in the current project.")
  .option("--preset <name>", `Policy preset: ${policyPresets().join(", ")}`, parsePreset, "default")
  .option("--android", "Use the android policy preset")
  .option("--node", "Use the node policy preset")
  .option("--python", "Use the python policy preset")
  .option("--mobile-ai", "Use the mobile-ai policy preset")
  .action((options: { preset: PolicyPreset; android?: boolean; node?: boolean; python?: boolean; mobileAi?: boolean }) => {
    const path = join(process.cwd(), "contextlock.config.json");
    if (existsSync(path)) {
      console.log("contextlock.config.json already exists");
      return;
    }

    const preset = selectedPreset(options);
    writeFileSync(path, `${JSON.stringify(createPolicy(preset), null, 2)}\n`);
    console.log(`Created contextlock.config.json (${preset} preset)`);
  });

program
  .command("scan")
  .description("Scan the current project for blocked files and redactable secrets.")
  .option("--fail-on <level>", "Exit 1 at this risk level", parseFailOn, "never")
  .action((options: { failOn: FailOn }) => {
    const summary = scanRisks(process.cwd(), loadPolicy(process.cwd()));
    console.log(JSON.stringify(summary, null, 2));
    applyRiskExitCode(summary, options.failOn);
  });

program
  .command("mcp")
  .description("Start the ContextLock MCP server over stdio.")
  .action(async () => {
    await startMcpServer(process.cwd());
  });

program
  .command("mcp-config")
  .description("Print a generic MCP client config snippet.")
  .option("--local", "Print a local-development pnpm config")
  .option("--cwd <path>", "Set the project directory for the MCP server")
  .action((options: { local?: boolean; cwd?: string }) => {
    const config = options.local
      ? {
          mcpServers: {
            contextlock: {
              command: "pnpm",
              args: ["dev", "--", "mcp"],
              ...(options.cwd ? { cwd: options.cwd } : {})
            }
          }
        }
      : {
          mcpServers: {
            contextlock: {
              command: "npx",
              args: ["--yes", "contextlock@1", "mcp"],
              ...(options.cwd ? { cwd: options.cwd } : {})
            }
          }
        };

    console.log(JSON.stringify(config, null, 2));
  });

program
  .command("report")
  .description("Print a concise human-readable safety report.")
  .option("--fail-on <level>", "Exit 1 at this risk level", parseFailOn, "never")
  .action((options: { failOn: FailOn }) => {
    const summary = scanRisks(process.cwd(), loadPolicy(process.cwd()));
    const redactionCount = summary.redactions.reduce((sum, item) => sum + item.count, 0);

    console.log("ContextLock AI Safety Report");
    console.log("");
    console.log(`Project: ${summary.root}`);
    console.log(`Risk level: ${summary.riskLevel}`);
    console.log(`Files scanned: ${summary.filesScanned}`);
    console.log(`Blocked files: ${summary.blockedFiles.length}`);
    console.log(`Secrets redacted: ${redactionCount}`);
    applyRiskExitCode(summary, options.failOn);
  });

program
  .command("why")
  .argument("<path>", "Project-relative path to explain")
  .description("Explain whether a path is allowed or blocked by the active policy.")
  .action((path: string) => {
    const cwd = process.cwd();
    const policy = loadPolicy(cwd);
    const validation = readFileSafe(cwd, path, policy);
    const pathValidationReasons = new Set([
      "Invalid path",
      "Absolute paths are not allowed",
      "Path escapes project root"
    ]);
    const explanation = validation.blocked && validation.reason && pathValidationReasons.has(validation.reason)
      ? {
          schemaVersion: 1 as const,
          path: validation.path,
          blocked: true,
          reason: validation.reason
        }
      : explainPolicyForPath(path, policy);
    console.log(JSON.stringify(explanation, null, 2));
  });

program
  .command("doctor")
  .description("Print local ContextLock diagnostics for this project.")
  .action(() => {
    const cwd = process.cwd();
    const configPath = join(cwd, "contextlock.config.json");
    const policy = loadPolicy(cwd);
    const sample = explainPolicyForPath(".env", policy);
    console.log(JSON.stringify({
      schemaVersion: 1,
      cwd,
      version: VERSION,
      node: process.version,
      config: {
        path: configPath,
        exists: existsSync(configPath),
        regularFile: fileStatus(configPath)
      },
      policy: {
        blockedPatterns: policy.blockedPatterns.length,
        redactors: policy.redact,
        sampleBlockedPath: sample
      },
      mcp: {
        command: "contextlock mcp",
        transport: "stdio"
      }
    }, null, 2));
  });

program
  .command("test-policy")
  .description("Run built-in allow/block assertions against the active policy.")
  .action(() => {
    const policy = loadPolicy(process.cwd());
    const checks = [
      { path: ".env", expected: true, required: true },
      { path: ".ENV", expected: true, required: true },
      { path: "build/generated/output.js", expected: true, required: true },
      { path: "app/build/outputs/app-release.apk", expected: true, required: true },
      { path: ".git/config", expected: true, required: true },
      { path: "src/index.ts", expected: false, required: false }
    ].map((check) => {
      const explanation = explainPolicyForPath(check.path, policy);
      return {
        path: check.path,
        expectedBlocked: check.expected,
        actualBlocked: explanation.blocked,
        required: check.required,
        passed: explanation.blocked === check.expected,
        matchedPattern: explanation.matchedPattern
      };
    });
    const passed = checks.every((check) => !check.required || check.passed);
    console.log(JSON.stringify({ schemaVersion: 1, passed, checks }, null, 2));
    if (!passed) process.exitCode = 1;
  });

function parseFailOn(value: string): FailOn {
  if (value === "never" || value === "medium" || value === "high") return value;
  throw new Error("--fail-on must be one of: never, medium, high");
}

function parsePreset(value: string): PolicyPreset {
  if (policyPresets().includes(value as PolicyPreset)) return value as PolicyPreset;
  throw new Error(`--preset must be one of: ${policyPresets().join(", ")}`);
}

function selectedPreset(options: { preset: PolicyPreset; android?: boolean; node?: boolean; python?: boolean; mobileAi?: boolean }): PolicyPreset {
  const flags: Array<[PolicyPreset, boolean | undefined]> = [
    ["android", options.android],
    ["node", options.node],
    ["python", options.python],
    ["mobile-ai", options.mobileAi]
  ];
  const selected = flags.filter(([, enabled]) => enabled).map(([preset]) => preset);
  if (selected.length > 1) throw new Error("Choose only one init preset flag.");
  return selected[0] ?? options.preset;
}

function fileStatus(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function applyRiskExitCode(summary: ScanSummary, failOn: FailOn): void {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  if (failOn !== "never" && rank[summary.riskLevel] >= rank[failOn]) {
    process.exitCode = 1;
  }
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
