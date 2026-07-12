#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { DEFAULT_POLICY, loadPolicy } from "./policy.js";
import { scanRisks } from "./scanner.js";
import { startMcpServer } from "./mcp.js";
import type { ScanSummary } from "./types.js";
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
  .action(() => {
    const path = join(process.cwd(), "contextlock.config.json");
    if (existsSync(path)) {
      console.log("contextlock.config.json already exists");
      return;
    }

    writeFileSync(path, `${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`);
    console.log("Created contextlock.config.json");
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

function parseFailOn(value: string): FailOn {
  if (value === "never" || value === "medium" || value === "high") return value;
  throw new Error("--fail-on must be one of: never, medium, high");
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
