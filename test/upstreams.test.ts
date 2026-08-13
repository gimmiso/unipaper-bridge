import { describe, expect, it, vi } from "vitest";
import {
  expandCitationNetwork,
  findOpenAccess,
  resolvePaper,
  type FetchLike,
} from "../src/upstreams.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("scholarly upstream adapters", () => {
  it("maps a Crossref DOI response to stable metadata", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        message: {
          DOI: "10.7717/peerj.4375",
          title: ["A <i>useful</i> paper"],
          author: [{ given: "Ada", family: "Lovelace" }],
          "published-online": { "date-parts": [[2018, 2, 13]] },
          "container-title": ["PeerJ"],
          publisher: "PeerJ",
          type: "journal-article",
          URL: "https://doi.org/10.7717/peerj.4375",
        },
      }),
    ) as unknown as FetchLike;

    const result = await resolvePaper("10.7717/peerj.4375", "doi", 5, {
      fetchImpl,
      crossrefMailto: "maintainer@example.org",
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      doi: "10.7717/peerj.4375",
      title: "A useful paper",
      authors: ["Ada Lovelace"],
      year: 2018,
    });
    const calledUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("mailto=maintainer%40example.org");
  });

  it("uses Crossref title search and respects the result limit", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        message: {
          items: [
            { DOI: "10.1000/one", title: ["One"] },
            { DOI: "10.1000/two", title: ["Two"] },
          ],
        },
      }),
    ) as unknown as FetchLike;

    const result = await resolvePaper("Attention Is All You Need", "title", 1, {
      fetchImpl,
    });
    expect(result.matches).toHaveLength(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("query.title=Attention+Is+All+You+Need");
  });

  it("maps an OpenAlex open-access location without exposing the API key", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: "https://openalex.org/W123",
        doi: "https://doi.org/10.7717/peerj.4375",
        title: "Example OA paper",
        publication_year: 2018,
        is_retracted: false,
        open_access: { is_oa: true, oa_url: "https://repository.example/paper" },
        best_oa_location: {
          landing_page_url: "https://repository.example/paper",
          pdf_url: "https://repository.example/paper.pdf",
          source: { display_name: "Example Repository" },
          license: "cc-by",
          version: "acceptedVersion",
        },
      }),
    ) as unknown as FetchLike;

    const result = await findOpenAccess("10.7717/peerj.4375", {
      fetchImpl,
      openAlexApiKey: "top-secret-test-key",
    });

    expect(result).toMatchObject({
      found: true,
      is_open_access: true,
      pdf_url: "https://repository.example/paper.pdf",
      license: "cc-by",
    });
    expect(JSON.stringify(result)).not.toContain("top-secret-test-key");
  });

  it("can use OpenAlex's lower no-key quota without university credentials", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: "https://openalex.org/W123",
        title: "Closed example",
        publication_year: 2020,
        open_access: { is_oa: false },
      }),
    ) as unknown as FetchLike;

    const result = await findOpenAccess("10.7717/peerj.4375", { fetchImpl });
    expect(result).toMatchObject({ found: true, is_open_access: false });
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain("api_key=");
  });

  it("turns an OpenAlex 404 into a normal not-found result", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "not found" }, 404)) as unknown as FetchLike;
    const result = await findOpenAccess("10.7717/peerj.4375", {
      fetchImpl,
      openAlexApiKey: "test-key",
    });
    expect(result).toMatchObject({ found: false, is_open_access: null });
  });

  it("expands, ranks, and deduplicates a bounded citation network", async () => {
    const work = (
      id: string,
      title: string,
      citedBy: number,
      doi: string,
      year: number,
    ) => ({
      id: `https://openalex.org/${id}`,
      doi: `https://doi.org/${doi}`,
      title,
      publication_year: year,
      type: "article",
      cited_by_count: citedBy,
      is_retracted: false,
      authorships: [{ author: { display_name: `${title} Author` } }],
      primary_location: {
        landing_page_url: `https://publisher.example/${id}`,
        source: { display_name: "Example Journal" },
      },
      best_oa_location: {
        landing_page_url: `https://repository.example/${id}`,
      },
      open_access: {
        is_oa: true,
        oa_url: `https://repository.example/${id}`,
      },
    });

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/works/doi%3A")) {
        return jsonResponse({
          ...work("W100", "Seed", 20, "10.1000/seed", 2020),
          referenced_works: [
            "https://openalex.org/W201",
            "https://openalex.org/W202",
          ],
          referenced_works_count: 2,
          related_works: [
            "https://openalex.org/W201",
            "https://openalex.org/W301",
          ],
        });
      }
      const filter = url.searchParams.get("filter") ?? "";
      if (filter === "openalex_id:W201|W202") {
        return jsonResponse({
          meta: { count: 2 },
          results: [
            work("W201", "Older low impact", 4, "10.1000/ref1", 2018),
            work("W202", "Older high impact", 90, "10.1000/ref2", 2017),
          ],
        });
      }
      if (filter === "cites:W100") {
        return jsonResponse({
          meta: { count: 12 },
          results: [work("W401", "Later", 30, "10.1000/later", 2023)],
        });
      }
      if (filter === "openalex_id:W201|W301") {
        return jsonResponse({
          meta: { count: 2 },
          results: [
            work("W201", "Older low impact", 4, "10.1000/ref1", 2018),
            work("W301", "Related", 2, "10.1000/related", 2022),
          ],
        });
      }
      return jsonResponse({ error: "unexpected request" }, 500);
    }) as unknown as FetchLike;

    const result = await expandCitationNetwork("10.1000/seed", 2, {
      fetchImpl,
      openAlexApiKey: "network-secret",
    });

    expect(result.seed).toMatchObject({ relation: "seed", openalex_id: "W100" });
    expect(result.earlier_works.map((paper) => paper.openalex_id)).toEqual([
      "W202",
      "W201",
    ]);
    expect(result.later_works).toEqual([
      expect.objectContaining({
        openalex_id: "W401",
        relation: "citing",
        cited_by_count: 30,
      }),
    ]);
    expect(result.similar_works.map((paper) => paper.openalex_id)).toEqual(["W301"]);
    expect(result.counts).toEqual({
      references_reported: 2,
      references_scanned: 2,
      citing_works_reported: 12,
      related_works_reported: 2,
    });
    expect(result.citation_stance).toBe("not_determined");
    expect(JSON.stringify(result)).not.toContain("network-secret");
  });

});
