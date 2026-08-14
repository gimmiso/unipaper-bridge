#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDraftAuditServer } from "./server.js";

async function main() {
  const server = createDraftAuditServer();
  await server.connect(new StdioServerTransport());
  console.error("UniPaper draft audit local MCP is running over stdio.");
}

main().catch(() => {
  console.error("UniPaper draft audit local MCP failed to start.");
  process.exitCode = 1;
});
