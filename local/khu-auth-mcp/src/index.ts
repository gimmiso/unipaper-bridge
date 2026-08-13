#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createKHULocalServer } from "./server.js";

async function main() {
  const server = createKHULocalServer();
  await server.connect(new StdioServerTransport());
  console.error("UniPaper KHU local MCP is running over stdio.");
}

main().catch(() => {
  console.error("UniPaper KHU local MCP failed to start.");
  process.exitCode = 1;
});
