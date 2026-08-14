import { describe, expect, it } from "vitest";
import {
  AuditInputError,
  auditDraftClaims,
  type AuditSourceInput,
  type DraftAuditInput,
} from "../src/audit.js";

function source(
  overrides: Partial<AuditSourceInput> = {},
): AuditSourceInput {
  return {
    source_id: "SRC1",
    doi: "10.1000/example",
    title: "Example paper",
    access_level: "FULLTEXT-OA",
    is_retracted: false,
    anchors: [
      {
        anchor_id: "A1",
        source_part: "table",
        locator: "p. 12, Table 3",
        evidence_summary: "The reported estimate is positive.",
      },
    ],
    ...overrides,
  };
}

function oneSentence(
  text: string,
  sources: AuditSourceInput[],
  relation: "SUPPORTS" | "PARTIALLY_SUPPORTS" | "CONTRADICTS" = "SUPPORTS",
): DraftAuditInput {
  return {
    draft_text: text,
    sources,
    sentences: [
      {
        sentence_id: "S1",
        text,
        start_offset: 0,
        end_offset: text.length,
        claims: [
          {
            claim_id: "C1",
            text,
            checked_source_ids: [sources[0]?.source_id ?? "SRC1"],
            evidence: [
              {
                source_id: sources[0]?.source_id ?? "SRC1",
                anchor_id: sources[0]?.anchors[0]?.anchor_id ?? "A1",
                relation,
                rationale: "The source directly addresses the same claim.",
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("draft claim audit", () => {
  it("returns direct full-text support with normalized DOI and exact location", () => {
    const text = "<X> | increased Y by 30%.";
    const result = auditDraftClaims(
      oneSentence(
        text,
        [source({ doi: "HTTPS://DOI.ORG/10.1000/EXAMPLE" })],
      ),
    );

    expect(result.status_counts).toEqual({
      SUPPORTED: 1,
      PARTIAL: 0,
      CONTRADICTED: 0,
      UNVERIFIED: 0,
    });
    expect(result.results[0]?.claim_results[0]).toMatchObject({
      status: "SUPPORTED",
      evidence_conflict: false,
      citations: [
        {
          doi: "10.1000/example",
          locator: "p. 12, Table 3",
          effective_relation: "SUPPORTS",
        },
      ],
    });
    expect(result.markdown).toContain("&lt;X&gt; \\| increased");
    expect(result.markdown).toContain("10.1000/example — table: p. 12, Table 3");
    expect(result.quality_summary.ready_for_use).toBe(true);
  });

  it("marks a compound sentence PARTIAL when only one atomic claim is supported", () => {
    const text = "X increased Y and generalized globally.";
    const input = oneSentence(text, [source()]);
    input.sentences[0]?.claims.push({
      claim_id: "C2",
      text: "The result generalized globally",
      checked_source_ids: ["SRC1"],
      evidence: [],
    });

    const result = auditDraftClaims(input);
    expect(result.results[0]?.status).toBe("PARTIAL");
    expect(result.results[0]?.claim_results.map((claim) => claim.status)).toEqual([
      "SUPPORTED",
      "UNVERIFIED",
    ]);
  });

  it("uses a conservative contradiction verdict and detects source conflicts", () => {
    const contradiction = auditDraftClaims(
      oneSentence("X decreased Y.", [source()], "CONTRADICTS"),
    );
    expect(contradiction.results[0]?.status).toBe("CONTRADICTED");

    const text = "X changes Y.";
    const input = oneSentence(text, [source()]);
    input.sources.push(
      source({
        source_id: "SRC2",
        doi: "10.1000/second",
        title: "Conflicting paper",
        anchors: [
          {
            anchor_id: "A2",
            source_part: "figure",
            locator: "p. 7, Figure 2",
            evidence_summary: "The estimate has the opposite direction.",
          },
        ],
      }),
    );
    const claim = input.sentences[0]?.claims[0];
    if (!claim) throw new Error("Expected test claim");
    claim.checked_source_ids.push("SRC2");
    claim.evidence.push({
      source_id: "SRC2",
      anchor_id: "A2",
      relation: "CONTRADICTS",
      rationale: "The second paper reports the opposite direction.",
    });

    const conflict = auditDraftClaims(input);
    expect(conflict.results[0]?.status).toBe("PARTIAL");
    expect(conflict.results[0]?.claim_results[0]?.evidence_conflict).toBe(true);
    expect(conflict.quality_issues).toContainEqual(
      expect.objectContaining({ code: "conflicting_evidence", severity: "warning" }),
    );
  });

  it("downgrades abstract evidence and rejects metadata or retracted evidence", () => {
    const abstractResult = auditDraftClaims(
      oneSentence(
        "X affects Y.",
        [
          source({
            access_level: "ABSTRACT-ONLY",
            anchors: [
              {
                anchor_id: "ABS",
                source_part: "abstract",
                locator: "Abstract",
                evidence_summary: "The abstract reports an association.",
              },
            ],
          }),
        ],
      ),
    );
    expect(abstractResult.results[0]?.status).toBe("PARTIAL");
    expect(abstractResult.quality_issues).toContainEqual(
      expect.objectContaining({ code: "abstract_only_evidence" }),
    );

    const metadataResult = auditDraftClaims(
      oneSentence(
        "X affects Y.",
        [
          source({
            access_level: "METADATA-ONLY",
            anchors: [
              {
                anchor_id: "META",
                source_part: "metadata",
                locator: "Crossref record",
                evidence_summary: "Bibliographic record only.",
              },
            ],
          }),
        ],
      ),
    );
    expect(metadataResult.results[0]?.status).toBe("UNVERIFIED");
    expect(metadataResult.quality_summary.ready_for_use).toBe(false);

    const retractedResult = auditDraftClaims(
      oneSentence("X affects Y.", [source({ is_retracted: true })]),
    );
    expect(retractedResult.results[0]?.status).toBe("UNVERIFIED");
    expect(retractedResult.quality_issues).toContainEqual(
      expect.objectContaining({ code: "retracted_source", severity: "critical" }),
    );
  });

  it("limits evidence with a missing DOI and rejects locators beyond known access", () => {
    const missingDoi = auditDraftClaims(
      oneSentence("X affects Y.", [source({ doi: null })]),
    );
    expect(missingDoi.results[0]?.status).toBe("PARTIAL");
    expect(missingDoi.quality_summary.ready_for_use).toBe(false);
    expect(missingDoi.quality_issues).toContainEqual(
      expect.objectContaining({ code: "missing_doi", severity: "critical" }),
    );

    const inaccessibleLocator = auditDraftClaims(
      oneSentence(
        "X affects Y.",
        [source({ access_level: "ABSTRACT-ONLY" })],
      ),
    );
    expect(inaccessibleLocator.results[0]?.status).toBe("UNVERIFIED");
    expect(inaccessibleLocator.quality_issues).toContainEqual(
      expect.objectContaining({ code: "access_anchor_mismatch", severity: "critical" }),
    );
  });

  it("requires exact draft offsets and valid source-anchor references", () => {
    const badOffset = oneSentence("Sensitive unpublished claim.", [source()]);
    if (badOffset.sentences[0]) badOffset.sentences[0].end_offset -= 1;
    expect(() => auditDraftClaims(badOffset)).toThrow(AuditInputError);

    const badAnchor = oneSentence("Another claim.", [source()]);
    const evidence = badAnchor.sentences[0]?.claims[0]?.evidence[0];
    if (evidence) evidence.anchor_id = "UNKNOWN";
    expect(() => auditDraftClaims(badAnchor)).toThrow(/unknown anchor/i);
  });
});
