import { describe, expect, it } from "vitest";
import { normalizeDoi, normalizeTitle, resolveQueryType } from "../src/doi.js";

describe("DOI and title normalization", () => {
  it("normalizes DOI labels and URLs", () => {
    expect(normalizeDoi("DOI: 10.7717/PeerJ.4375")).toBe("10.7717/peerj.4375");
    expect(normalizeDoi("https://doi.org/10.7717/peerj.4375?ignored=yes")).toBe(
      "10.7717/peerj.4375",
    );
  });

  it("rejects malformed DOI values", () => {
    expect(() => normalizeDoi("not-a-doi")).toThrow(/does not look like a DOI/i);
  });

  it("normalizes titles and detects query types", () => {
    expect(normalizeTitle("  Attention   Is All You Need ")).toBe(
      "Attention Is All You Need",
    );
    expect(resolveQueryType("10.7717/peerj.4375", "auto").type).toBe("doi");
    expect(resolveQueryType("Attention Is All You Need", "auto").type).toBe("title");
  });
});
