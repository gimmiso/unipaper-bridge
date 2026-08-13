#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createZoteroLocalServer } from "./server.js";

async function main() {
  const server = createZoteroLocalServer();
  await server.connect(new StdioServerTransport());
  console.error("UniPaper Zotero local MCP is running over stdio.");
}

main().catch(() => {
  console.error("UniPaper Zotero local MCP failed to start.");
  process.exitCode = 1;
});
