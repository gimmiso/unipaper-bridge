import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import rateLimit from "express-rate-limit";
import type { Server as HttpServer } from "node:http";
import { createUniPaperServer, SERVER_VERSION } from "./mcp-server.js";
import type { ScholarlyDependencies } from "./upstreams.js";

export interface HttpServerOptions {
  host: string;
  port: number;
  allowedHosts?: string[];
  trustProxy?: boolean | number;
  dependencies?: ScholarlyDependencies;
}

export function createHttpApp(options: HttpServerOptions) {
  const app = createMcpExpressApp({
    host: options.host,
    ...(options.allowedHosts?.length ? { allowedHosts: options.allowedHosts } : {}),
  });
  app.disable("x-powered-by");
  if (options.trustProxy !== undefined) {
    app.set("trust proxy", options.trustProxy);
  }

  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok", service: "unipaper-bridge", version: SERVER_VERSION });
  });

  app.use(
    "/mcp",
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );

  app.post("/mcp", async (request, response) => {
    const server = createUniPaperServer(options.dependencies);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    response.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("MCP request failed:", error instanceof Error ? error.message : "unknown error");
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_request: unknown, response: import("express").Response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}

export async function startHttpServer(options: HttpServerOptions): Promise<HttpServer> {
  const app = createHttpApp(options);
  return await new Promise<HttpServer>((resolve, reject) => {
    const server = app.listen(options.port, options.host, () => resolve(server));
    server.once("error", reject);
  });
}
