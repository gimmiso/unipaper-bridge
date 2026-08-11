import { describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../src/errors.js";
import { findOpenAccess, resolvePaper, type FetchLike } from "../src/upstreams.js";

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

  it("requires the operator's OpenAlex key, never a university credential", async () => {
    await expect(findOpenAccess("10.7717/peerj.4375")).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  it("turns an OpenAlex 404 into a normal not-found result", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "not found" }, 404)) as unknown as FetchLike;
    const result = await findOpenAccess("10.7717/peerj.4375", {
      fetchImpl,
      openAlexApiKey: "test-key",
    });
    expect(result).toMatchObject({ found: false, is_open_access: null });
  });
});
