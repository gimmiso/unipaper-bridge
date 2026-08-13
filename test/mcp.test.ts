import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createUniPaperServer } from "../src/mcp-server.js";

describe("MCP contract", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function connectedClient() {
    const server = createUniPaperServer();
    const client = new Client({ name: "unipaper-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closers.push(async () => {
      await client.close();
      await server.close();
    });
    return client;
  }

  it("advertises five focused read-only tools with annotations", async () => {
    const client = await connectedClient();
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "resolve_paper",
      "expand_citation_network",
      "find_open_access",
      "list_institutions",
      "build_institution_link",
    ]);
    expect(result.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(result.tools.every((tool) => tool.annotations?.destructiveHint === false)).toBe(
      true,
    );
    expect(
      result.tools.find((tool) => tool.name === "expand_citation_network")?.description,
    ).toMatch(/never proves support or contradiction/i);
  });

  it("returns model-readable and structured institutional link results", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "build_institution_link",
      arguments: {
        institution_id: "khu-global",
        target_url: "https://www.sciencedirect.com/science/article/pii/example",
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      institution_id: "khu-global",
      credentials_handled_by_server: false,
    });
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text" })]),
    );
  });

  it("rejects unsafe proxy targets as a tool error", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "build_institution_link",
      arguments: {
        institution_id: "khu-seoul",
        target_url: "http://127.0.0.1/admin",
      },
    });
    expect(result.isError).toBe(true);
  });
});
