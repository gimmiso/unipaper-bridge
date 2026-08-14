import { describe, expect, it } from "vitest";
import {
  buildEvidenceMatrix,
  type EvidenceFieldValue,
  type EvidenceMatrixPaperInput,
} from "../src/evidence-matrix.js";

const reported = (value: string): EvidenceFieldValue => ({ status: "reported", value });
const missing = (status: Exclude<EvidenceFieldValue["status"], "reported">) => ({
  status,
  value: null,
}) satisfies EvidenceFieldValue;

function paper(
  overrides: Partial<EvidenceMatrixPaperInput> = {},
): EvidenceMatrixPaperInput {
  return {
    doi: "10.1000/example",
    title: "Example paper",
    authors: ["Ada Researcher"],
    year: 2024,
    venue: "Journal of Examples",
    access_level: "FULLTEXT-OA",
    is_retracted: false,
    research_task: reported("Estimate the target outcome"),
    setting: reported("East Asia"),
    sample: reported("1,200 observations"),
    data_source: reported("Public longitudinal dataset"),
    method: reported("Panel regression"),
    evaluation: reported("Held-out temporal validation"),
    key_findings: reported("The primary estimate was positive"),
    limitations: missing("not_reported"),
    evidence_anchors: [
      {
        claim: "Primary study details, method, and result",
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
        locator: "p. 12, Table 3",
      },
    ],
    inclusion_reason: "Direct evidence for the comparison",
    ...overrides,
  };
}

describe("multi-paper evidence matrix", () => {
  it("deduplicates, normalizes DOI, and renders Markdown plus CSV", () => {
    const result = buildEvidenceMatrix({
      research_question: "How do methods and results differ?",
      papers: [
        paper({ doi: "HTTPS://DOI.ORG/10.1000/EXAMPLE", title: "Paper <One> | Study" }),
        paper({
          doi: "10.1000/second",
          title: "Second paper",
          year: 2023,
          key_findings: reported("=FORMULA(1), with a comma"),
        }),
        paper({ doi: "10.1000/example", title: "A duplicate metadata record" }),
      ],
    });

    expect(result.row_count).toBe(2);
    expect(result.duplicates_omitted).toEqual([
      expect.objectContaining({ input_position: 3, duplicate_of: "E1", matched_by: "doi" }),
    ]);
    expect(result.rows[0]?.doi).toBe("10.1000/example");
    expect(result.markdown).toContain("Paper &lt;One&gt; \\| Study");
    expect(result.markdown).toContain("p. 12, Table 3");
    expect(result.csv).toContain('"\'=FORMULA(1), with a comma"');
    expect(result.quality_summary).toMatchObject({
      ready_for_synthesis: true,
      critical_issues: 0,
      fulltext_rows: 2,
      rows_with_anchors: 2,
    });
  });

  it("flags access/evidence mismatches instead of silently accepting them", () => {
    const result = buildEvidenceMatrix({
      research_question: "Can these papers support the claim?",
      papers: [
        paper({
          title: "Abstract paper",
          doi: "10.1000/abstract",
          access_level: "ABSTRACT-ONLY",
          is_retracted: true,
          evidence_anchors: [
            {
              claim: "Claimed result",
              supports: ["key_findings"],
              source_part: "table",
              locator: "Table 2",
            },
          ],
        }),
        paper({
          title: "Metadata paper",
          doi: "10.1000/metadata",
          access_level: "METADATA-ONLY",
          evidence_anchors: [
            {
              claim: "Bibliographic identity",
              supports: ["research_task"],
              source_part: "metadata",
              locator: "DOI record",
            },
          ],
        }),
      ],
    });

    expect(result.quality_summary.ready_for_synthesis).toBe(false);
    expect(result.quality_issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "retracted_source",
        "unanchored_reported_field",
        "abstract_anchor_mismatch",
        "unsupported_metadata_detail",
      ]),
    );
  });

  it("requires every reported field to map to an evidence location", () => {
    const result = buildEvidenceMatrix({
      research_question: "Compare field coverage",
      papers: [
        paper({
          doi: "10.1000/partial-anchor",
          title: "Partially anchored paper",
          evidence_anchors: [
            {
              claim: "Only the result",
              supports: ["key_findings"],
              source_part: "main_text",
              locator: "p. 9",
            },
          ],
        }),
        paper({ doi: "10.1000/complete-anchor", title: "Completely anchored paper" }),
      ],
    });

    expect(result.quality_summary.ready_for_synthesis).toBe(false);
    expect(result.quality_issues).toContainEqual(
      expect.objectContaining({ row_id: "E1", code: "unanchored_reported_field" }),
    );
  });

  it("requires null for fields that were not reported, applicable, or checked", () => {
    expect(() =>
      buildEvidenceMatrix({
        research_question: "Compare two papers",
        papers: [
          paper({ limitations: { status: "not_checked", value: "guessed limitation" } }),
          paper({ doi: "10.1000/second", title: "Second paper" }),
        ],
      }),
    ).toThrow(/value must be null/i);
  });

  it("does not collapse distinct DOI records that share a title and year", () => {
    const result = buildEvidenceMatrix({
      research_question: "Compare same-titled works",
      papers: [
        paper({ doi: "10.1000/first", title: "Shared title", year: 2024 }),
        paper({ doi: "10.1000/second", title: "Shared title", year: 2024 }),
      ],
    });

    expect(result.row_count).toBe(2);
    expect(result.duplicates_omitted).toEqual([]);
  });

  it("treats inspected institutional text as a full-text evidence row", () => {
    const result = buildEvidenceMatrix({
      research_question: "Can licensed evidence support synthesis?",
      papers: [
        paper({ access_level: "FULLTEXT-LICENSED" }),
        paper({ doi: "10.1000/oa-control", title: "OA control paper" }),
      ],
    });

    expect(result.quality_summary).toMatchObject({
      ready_for_synthesis: true,
      fulltext_rows: 2,
      limited_access_rows: 0,
    });
  });
});
