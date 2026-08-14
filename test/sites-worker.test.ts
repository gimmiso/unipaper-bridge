import { afterEach, describe, expect, it, vi } from "vitest";
// The deployed Worker is plain ESM so the exact production source can be tested.
// @ts-expect-error The deployment file intentionally has no TypeScript declarations.
import worker from "../deploy/sites-worker.js";

async function call(body: Record<string, unknown>, env: Record<string, string> = {}) {
  const response = await worker.fetch(
    new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    env,
    {},
  );
  return { response, body: await response.json() };
}

describe("deployed Sites Worker", () => {
  afterEach(() => vi.restoreAllMocks());

  it("initializes and advertises the six public tools", async () => {
    const initialized = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {} },
    });
    expect(initialized.response.status).toBe(200);
    expect(initialized.body.result.serverInfo.name).toBe("unipaper-bridge");

    const listed = await call({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(listed.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "resolve_paper",
      "expand_citation_network",
      "find_open_access",
      "build_evidence_matrix",
      "list_institutions",
      "build_institution_link",
    ]);
  });

  it("builds the same evidence matrix contract in the deployed Worker", async () => {
    const reported = (value: string) => ({ status: "reported", value });
    const paper = (doi: string, title: string) => ({
      doi,
      title,
      authors: ["Example Author"],
      year: 2024,
      venue: "Example Journal",
      access_level: "FULLTEXT-OA",
      is_retracted: false,
      research_task: reported("Compare an outcome"),
      setting: reported("East Asia"),
      sample: reported("500 observations"),
      data_source: reported("Public dataset"),
      method: reported("Regression"),
      evaluation: reported("Held-out validation"),
      key_findings: reported("The main estimate was positive"),
      limitations: { status: "not_reported", value: null },
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
          source_part: "table",
          locator: "p. 8, Table 2",
        },
      ],
      inclusion_reason: "Directly addresses the research question",
    });
    const matrix = await call({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "build_evidence_matrix",
        arguments: {
          research_question: "How do these papers compare?",
          papers: [
            paper("10.1000/first", "First paper"),
            paper("10.1000/second", "Second paper"),
          ],
        },
      },
    });

    expect(matrix.body.result.structuredContent).toMatchObject({
      row_count: 2,
      quality_summary: { ready_for_synthesis: true, critical_issues: 0 },
    });
    expect(matrix.body.result.structuredContent.markdown).toMatch(/Evidence matrix/);
    expect(matrix.body.result.structuredContent.csv).toMatch(/Evidence locations/);
  });

  it("builds browser-only KHU links and rejects literal IP targets", async () => {
    const link = await call({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "build_institution_link",
        arguments: {
          institution_id: "khu-seoul",
          target_url: "https://doi.org/10.1000/test",
        },
      },
    });
    expect(link.body.result.structuredContent.credentials_handled_by_server).toBe(false);
    expect(link.body.result.structuredContent.access_url).toMatch(
      /^https:\/\/openlink\.khu\.ac\.kr\//,
    );

    const blocked = await call({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "build_institution_link",
        arguments: {
          institution_id: "khu-seoul",
          target_url: "http://127.0.0.1/private",
        },
      },
    });
    expect(blocked.body.result.isError).toBe(true);
  });

  it("expands citation networks without exposing the operator key", async () => {
    const work = (id: string, title: string, doi: string, citedBy = 1) => ({
      id: `https://openalex.org/${id}`,
      doi: `https://doi.org/${doi}`,
      title,
      publication_year: 2024,
      type: "article",
      cited_by_count: citedBy,
      is_retracted: false,
      authorships: [{ author: { display_name: "Example Author" } }],
      primary_location: { source: { display_name: "Example Journal" } },
      open_access: { is_oa: false },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/works/doi%3A")) {
        return new Response(
          JSON.stringify({
            ...work("W100", "Seed", "10.1000/seed", 10),
            referenced_works: ["https://openalex.org/W200"],
            referenced_works_count: 1,
            related_works: ["https://openalex.org/W300"],
          }),
        );
      }
      const filter = url.searchParams.get("filter");
      const body =
        filter === "openalex_id:W200"
          ? { meta: { count: 1 }, results: [work("W200", "Earlier", "10.1000/earlier", 30)] }
          : filter === "cites:W100"
            ? { meta: { count: 1 }, results: [work("W400", "Later", "10.1000/later", 5)] }
            : { meta: { count: 1 }, results: [work("W300", "Similar", "10.1000/similar", 3)] };
      return new Response(JSON.stringify(body));
    });

    const expanded = await call(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "expand_citation_network",
          arguments: { doi: "10.1000/seed", per_relation: 2 },
        },
      },
      { OPENALEX_API_KEY: "worker-network-secret" },
    );

    expect(expanded.body.result.structuredContent).toMatchObject({
      citation_stance: "not_determined",
      earlier_works: [{ openalex_id: "W200" }],
      later_works: [{ openalex_id: "W400" }],
      similar_works: [{ openalex_id: "W300" }],
    });
    expect(JSON.stringify(expanded.body)).not.toContain("worker-network-secret");
  });
});
