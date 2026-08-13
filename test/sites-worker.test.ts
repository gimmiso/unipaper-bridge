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

  it("initializes and advertises the five public tools", async () => {
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
      "list_institutions",
      "build_institution_link",
    ]);
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
