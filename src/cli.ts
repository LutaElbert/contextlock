#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { DEFAULT_POLICY, loadPolicy } from "./policy.js";
import { scanRisks } from "./scanner.js";
import { startMcpServer } from "./mcp.js";

const program = new Command();

program
  .name("contextlock")
  .description("Local-first MCP safety layer for AI coding agents.")
  .version("0.1.0");

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
  .action(() => {
    const summary = scanRisks(process.cwd(), loadPolicy(process.cwd()));
    console.log(JSON.stringify(summary, null, 2));
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
  .action((options: { local?: boolean }) => {
    const config = options.local
      ? {
          mcpServers: {
            contextlock: {
              command: "pnpm",
              args: ["dev", "--", "mcp"]
            }
          }
        }
      : {
          mcpServers: {
            contextlock: {
              command: "npx",
              args: ["contextlock", "mcp"]
            }
          }
        };

    console.log(JSON.stringify(config, null, 2));
  });

program
  .command("report")
  .description("Print a concise human-readable safety report.")
  .action(() => {
    const summary = scanRisks(process.cwd(), loadPolicy(process.cwd()));
    const redactionCount = summary.redactions.reduce((sum, item) => sum + item.count, 0);

    console.log("ContextLock AI Safety Report");
    console.log("");
    console.log(`Project: ${summary.root}`);
    console.log(`Risk level: ${summary.riskLevel}`);
    console.log(`Files scanned: ${summary.filesScanned}`);
    console.log(`Blocked files: ${summary.blockedFiles.length}`);
    console.log(`Secrets redacted: ${redactionCount}`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
