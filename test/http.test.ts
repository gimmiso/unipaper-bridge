import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpApp } from "../src/http-server.js";

describe("Streamable HTTP endpoint", () => {
  let httpServer: Server | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    await new Promise<void>((resolve, reject) => {
      if (!httpServer) return resolve();
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("serves health and MCP tool discovery", async () => {
    const app = createHttpApp({ host: "127.0.0.1", port: 0 });
    httpServer = await new Promise<Server>((resolve, reject) => {
      const server = app.listen(0, "127.0.0.1", () => resolve(server));
      server.once("error", reject);
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address.");

    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/healthz`);
    expect(await health.json()).toMatchObject({ status: "ok", service: "unipaper-bridge" });

    client = new Client({ name: "http-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(5);
  });
});
