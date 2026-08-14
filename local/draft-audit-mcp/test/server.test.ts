import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createDraftAuditServer } from "../src/server.js";

describe("draft audit local MCP contract", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function connectedClient() {
    const server = createDraftAuditServer();
    const client = new Client({ name: "draft-audit-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closers.push(async () => {
      await client.close();
      await server.close();
    });
    return client;
  }

  const argumentsFor = (text: string, endOffset = text.length) => ({
    draft_text: text,
    sources: [
      {
        source_id: "SRC1",
        doi: "10.1000/example",
        title: "Example paper",
        access_level: "FULLTEXT-USER",
        is_retracted: false,
        anchors: [
          {
            anchor_id: "A1",
            source_part: "main_text",
            locator: "p. 4, Results",
            evidence_summary: "The paper reports the same direction.",
          },
        ],
      },
    ],
    sentences: [
      {
        sentence_id: "S1",
        text,
        start_offset: 0,
        end_offset: endOffset,
        claims: [
          {
            claim_id: "C1",
            text,
            checked_source_ids: ["SRC1"],
            evidence: [
              {
                source_id: "SRC1",
                anchor_id: "A1",
                relation: "SUPPORTS",
                rationale: "Direct match.",
              },
            ],
          },
        ],
      },
    ],
  });

  it("exposes exactly one local read-only tool", async () => {
    const client = await connectedClient();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["audit_draft_claims"]);
    expect(tools.tools[0]?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(tools.tools[0]?.description).toMatch(/does not read sources/i);
  });

  it("returns structured and model-readable sentence verdicts", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "audit_draft_claims",
      arguments: argumentsFor("X increases Y."),
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      sentence_count: 1,
      status_counts: { SUPPORTED: 1 },
      results: [{ sentence_id: "S1", status: "SUPPORTED" }],
    });
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text" })]),
    );
  });

  it("rejects offset mismatches without reflecting unpublished draft text", async () => {
    const client = await connectedClient();
    const privateDraft = "private-unpublished-draft-marker";
    const result = await client.callTool({
      name: "audit_draft_claims",
      arguments: argumentsFor(privateDraft, privateDraft.length - 1),
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(privateDraft);
  });
});
