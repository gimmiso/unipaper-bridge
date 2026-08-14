import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createUniPaperServer } from "../src/mcp-server.js";

const reported = (value: string) => ({ status: "reported" as const, value });

function evidencePaper(doi: string, title: string) {
  return {
    doi,
    title,
    authors: ["Example Author"],
    year: 2024,
    venue: "Example Journal",
    access_level: "FULLTEXT-OA" as const,
    is_retracted: false,
    research_task: reported("Compare an outcome"),
    setting: reported("East Asia"),
    sample: reported("500 observations"),
    data_source: reported("Public dataset"),
    method: reported("Regression"),
    evaluation: reported("Held-out validation"),
    key_findings: reported("The main estimate was positive"),
    limitations: { status: "not_reported" as const, value: null },
    evidence_anchors: [
      {
        claim: "Study details, method, and result",
        supports: [
          "research_task",
          "setting",
          "sample",
          "data_source",
          "method",
          "evaluation",
          "key_findings",
        ],
        source_part: "table" as const,
        locator: "p. 8, Table 2",
      },
    ],
    inclusion_reason: "Directly addresses the research question",
  };
}

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

  it("advertises six focused read-only tools with annotations", async () => {
    const client = await connectedClient();
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "resolve_paper",
      "expand_citation_network",
      "find_open_access",
      "build_evidence_matrix",
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
    expect(
      result.tools.find((tool) => tool.name === "build_evidence_matrix")?.annotations
        ?.openWorldHint,
    ).toBe(false);
  });

  it("builds a deduplicated evidence matrix with Markdown and CSV", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "build_evidence_matrix",
      arguments: {
        research_question: "How do these papers compare?",
        papers: [
          evidencePaper("10.1000/first", "First paper"),
          evidencePaper("10.1000/second", "Second paper"),
        ],
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      row_count: 2,
      quality_summary: { ready_for_synthesis: true, critical_issues: 0 },
    });
    expect(result.structuredContent?.markdown).toMatch(/Evidence matrix/);
    expect(result.structuredContent?.csv).toMatch(/Evidence locations/);
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
