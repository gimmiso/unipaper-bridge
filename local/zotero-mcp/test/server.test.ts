import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  createZoteroLocalServer,
  type ZoteroPaperStore,
} from "../src/server.js";
import type { SavePaperInput } from "../src/zotero-client.js";

class MemoryPreference {
  constructor(private value = false) {}

  async enabled() {
    return this.value;
  }

  async setEnabled(enabled: boolean) {
    this.value = enabled;
  }
}

class RecordingStore implements ZoteroPaperStore {
  readonly saves: SavePaperInput[] = [];

  async status() {
    return {
      ready: true,
      api_running: true,
      connector_running: true,
      destination: "My Library",
      files_editable: true,
      zotero_version: "9.0.6",
    };
  }

  async savePaper(input: SavePaperInput) {
    this.saves.push(input);
    return {
      status: "saved_with_fulltext" as const,
      item_key: "ABC12345",
      duplicate: false,
      fulltext_attached: true,
      attachment_status: "saved" as const,
      destination: "My Library",
    };
  }
}

describe("Zotero local MCP contract", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function connectedClient(
    store: ZoteroPaperStore,
    preference = new MemoryPreference(),
  ) {
    const server = createZoteroLocalServer(store, preference);
    const client = new Client({ name: "zotero-local-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closers.push(async () => {
      await client.close();
      await server.close();
    });
    return client;
  }

  it("exposes readiness and one focused write tool", async () => {
    const client = await connectedClient(new RecordingStore());
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "zotero_research_status",
      "configure_zotero_autosave",
      "save_research_paper_to_zotero",
    ]);
    expect(tools.tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools[1]?.annotations?.readOnlyHint).toBe(false);
    expect(tools.tools[2]?.annotations?.readOnlyHint).toBe(false);
  });

  it("persists explicit automatic-save consent", async () => {
    const preference = new MemoryPreference();
    const client = await connectedClient(new RecordingStore(), preference);
    const configured = await client.callTool({
      name: "configure_zotero_autosave",
      arguments: { enabled: true },
    });
    expect(configured.structuredContent).toEqual({
      status: "configured",
      auto_save_enabled: true,
    });
    const status = await client.callTool({
      name: "zotero_research_status",
      arguments: {},
    });
    expect(status.structuredContent).toMatchObject({ auto_save_enabled: true });
  });

  it("saves a verified OA paper without reflecting local inputs", async () => {
    const store = new RecordingStore();
    const client = await connectedClient(store);
    const result = await client.callTool({
      name: "save_research_paper_to_zotero",
      arguments: {
        title: "A verified paper",
        doi: "10.1000/example",
        attachment_mode: "oa",
        tags: ["core-evidence"],
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: "saved_with_fulltext",
      item_key: "ABC12345",
      fulltext_attached: true,
    });
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]?.attachment_mode).toBe("oa");
  });

  it("requires a PDF path for either local PDF mode", async () => {
    const store = new RecordingStore();
    const client = await connectedClient(store);
    const result = await client.callTool({
      name: "save_research_paper_to_zotero",
      arguments: {
        title: "A licensed paper",
        attachment_mode: "user-pdf",
      },
    });
    expect(result.isError).toBe(true);
    expect(store.saves).toEqual([]);

    const licensed = await client.callTool({
      name: "save_research_paper_to_zotero",
      arguments: {
        title: "A licensed paper",
        doi: "10.1000/licensed",
        attachment_mode: "licensed-pdf",
        local_pdf_path: "/tmp/unipaper-khu-example/paper.pdf",
      },
    });
    expect(licensed.isError).not.toBe(true);
    expect(store.saves[0]?.attachment_mode).toBe("licensed-pdf");
  });

  it("does not expose underlying local errors", async () => {
    const secret = "private-local-detail";
    const client = await connectedClient({
      async status() {
        throw new Error(secret);
      },
      async savePaper() {
        throw new Error(secret);
      },
    });
    const result = await client.callTool({
      name: "save_research_paper_to_zotero",
      arguments: { title: "Example", attachment_mode: "metadata-only" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
