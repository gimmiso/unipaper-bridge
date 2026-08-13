import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  createKHULocalServer,
  type KHUHelperLauncher,
} from "../src/server.js";

class RecordingLauncher implements KHUHelperLauncher {
  readonly calls: string[] = [];

  async launch(accessURL: string): Promise<void> {
    this.calls.push(accessURL);
  }
}

describe("KHU local MCP security boundary", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function connectedClient(launcher: KHUHelperLauncher) {
    const server = createKHULocalServer(launcher);
    const client = new Client({ name: "khu-local-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closers.push(async () => {
      await client.close();
      await server.close();
    });
    return client;
  }

  it("exposes only the action tool and no credential getter", async () => {
    const client = await connectedClient(new RecordingLauncher());
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name)).toEqual(["open_khu_paper"]);
    expect(JSON.stringify(result.tools)).not.toMatch(/get.*password|credential.*value/i);
  });

  it("returns only a safe launch status", async () => {
    const launcher = new RecordingLauncher();
    const client = await connectedClient(launcher);
    const marker = "must-not-return-this-input";
    const result = await client.callTool({
      name: "open_khu_paper",
      arguments: {
        institution_id: "khu-seoul",
        target_url: `https://doi.org/10.1000/example?marker=${marker}`,
      },
    });
    const serialized = JSON.stringify(result);

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      status: "browser_opened",
      credential_exposed: false,
    });
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toMatch(/password|account|username/i);
    expect(launcher.calls).toHaveLength(1);
    expect(launcher.calls[0]).toContain("openlink.khu.ac.kr/link.n2s?url=");
  });

  it("does not reflect helper errors back to the model", async () => {
    const secret = "secret-from-an-underlying-error";
    const client = await connectedClient({
      async launch() {
        throw new Error(secret);
      },
    });
    const result = await client.callTool({
      name: "open_khu_paper",
      arguments: {
        institution_id: "khu-global",
        target_url: "https://doi.org/10.1000/example",
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.structuredContent).toEqual({
      status: "error",
      code: "local_helper_unavailable",
      credential_exposed: false,
    });
  });

  it("rejects private and nested proxy targets before launching", async () => {
    const launcher = new RecordingLauncher();
    const client = await connectedClient(launcher);
    for (const target_url of [
      "http://127.0.0.1/admin",
      "http://[::1]/admin",
      "http://2130706433/admin",
      "https://webgate.khu.ac.kr/link.n2s?url=https://example.com",
      "file:///etc/passwd",
    ]) {
      const result = await client.callTool({
        name: "open_khu_paper",
        arguments: { institution_id: "khu-seoul", target_url },
      });
      expect(result.isError).toBe(true);
    }
    expect(launcher.calls).toEqual([]);
  });
});
