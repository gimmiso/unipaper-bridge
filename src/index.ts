#!/usr/bin/env node
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createUniPaperServer } from "./mcp-server.js";
import { startHttpServer } from "./http-server.js";
import type { ScholarlyDependencies } from "./upstreams.js";

function readPort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function dependenciesFromEnvironment(): ScholarlyDependencies {
  return {
    ...(process.env.CROSSREF_MAILTO
      ? { crossrefMailto: process.env.CROSSREF_MAILTO }
      : {}),
    ...(process.env.OPENALEX_API_KEY
      ? { openAlexApiKey: process.env.OPENALEX_API_KEY }
      : {}),
  };
}

function readTrustProxy(value: string | undefined): boolean | number | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  const hops = Number.parseInt(normalized, 10);
  if (Number.isInteger(hops) && hops >= 0 && String(hops) === normalized) return hops;
  throw new Error("TRUST_PROXY must be true, false, or a non-negative hop count.");
}

async function main() {
  const dependencies = dependenciesFromEnvironment();

  if (process.argv.includes("--stdio")) {
    const server = createUniPaperServer(dependencies);
    await server.connect(new StdioServerTransport());
    console.error("UniPaper Bridge MCP is running over stdio.");
    return;
  }

  const host = process.env.HOST?.trim() || "127.0.0.1";
  const port = readPort(process.env.PORT);
  const allowedHosts = process.env.ALLOWED_HOSTS?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const trustProxy = readTrustProxy(process.env.TRUST_PROXY);
  const httpServer = await startHttpServer({
    host,
    port,
    ...(allowedHosts?.length ? { allowedHosts } : {}),
    ...(trustProxy !== undefined ? { trustProxy } : {}),
    dependencies,
  });

  console.log(`UniPaper Bridge MCP listening at http://${host}:${port}/mcp`);

  const shutdown = () => {
    httpServer.close((error) => {
      if (error) {
        console.error("Failed to close HTTP server:", error.message);
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Failed to start UniPaper Bridge.");
  process.exitCode = 1;
});
