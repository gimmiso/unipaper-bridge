import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { buildEvidenceMatrix } from "./evidence-matrix.js";
import { publicErrorMessage } from "./errors.js";
import { buildInstitutionLink, listInstitutions } from "./institutions.js";
import {
  expandCitationNetwork,
  findOpenAccess,
  resolvePaper,
  type ScholarlyDependencies,
} from "./upstreams.js";

export const SERVER_NAME = "unipaper-bridge";
export const SERVER_VERSION = "0.4.0";

const paperMatchSchema = z.object({
  doi: z.string().nullable(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  publisher: z.string().nullable(),
  type: z.string().nullable(),
  canonical_url: z.string().nullable(),
});

const citationNetworkPaperSchema = z.object({
  relation: z.enum(["seed", "referenced", "citing", "related"]),
  openalex_id: z.string(),
  doi: z.string().nullable(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  type: z.string().nullable(),
  cited_by_count: z.number().int(),
  is_open_access: z.boolean().nullable(),
  is_retracted: z.boolean().nullable(),
  canonical_url: z.string(),
  oa_url: z.string().nullable(),
  relationship_note: z.string(),
});

const institutionSchema = z.object({
  id: z.string(),
  institution: z.string(),
  campus: z.string(),
  country: z.string(),
  access_guide_url: z.string(),
  fair_use_policy_url: z.string(),
  access_url_pattern: z.string(),
  authentication: z.literal("user_browser"),
  credentials_handled_by_server: z.literal(false),
  usage_note: z.string(),
  working_download_ceiling_per_publisher_per_day: z.number().int(),
});

const evidenceFieldSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("reported"), value: z.string().min(1).max(1500) }),
  z.object({ status: z.literal("not_reported"), value: z.null() }),
  z.object({ status: z.literal("not_applicable"), value: z.null() }),
  z.object({ status: z.literal("not_checked"), value: z.null() }),
]);

const evidenceAnchorSchema = z.object({
  claim: z.string().min(1).max(500),
  supports: z
    .array(
      z.enum([
        "research_task",
        "setting",
        "sample",
        "data_source",
        "method",
        "evaluation",
        "key_findings",
        "limitations",
      ]),
    )
    .min(1)
    .max(8)
    .describe("The reported matrix fields supported by this exact source location."),
  source_part: z.enum([
    "abstract",
    "main_text",
    "figure",
    "table",
    "supplement",
    "metadata",
  ]),
  locator: z
    .string()
    .min(1)
    .max(300)
    .describe("An exact page, section, paragraph, figure, table, supplement, or record locator."),
});

const evidencePaperInputSchema = z.object({
  doi: z.string().min(1).max(512).nullable().optional(),
  title: z.string().min(3).max(500),
  authors: z.array(z.string().min(1).max(200)).max(20).default([]),
  year: z.number().int().min(1000).max(3000).nullable().default(null),
  venue: z.string().min(1).max(500).nullable().default(null),
  access_level: z.enum([
    "FULLTEXT-OA",
    "FULLTEXT-USER",
    "ABSTRACT-ONLY",
    "METADATA-ONLY",
  ]),
  is_retracted: z.boolean().nullable().default(null),
  research_task: evidenceFieldSchema,
  setting: evidenceFieldSchema,
  sample: evidenceFieldSchema,
  data_source: evidenceFieldSchema,
  method: evidenceFieldSchema,
  evaluation: evidenceFieldSchema,
  key_findings: evidenceFieldSchema,
  limitations: evidenceFieldSchema,
  evidence_anchors: z.array(evidenceAnchorSchema).max(10).default([]),
  inclusion_reason: z.string().min(1).max(1000),
});

const evidenceRowSchema = evidencePaperInputSchema.extend({
  row_id: z.string(),
  doi: z.string().nullable(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  is_retracted: z.boolean().nullable(),
  evidence_anchors: z.array(evidenceAnchorSchema),
});

const evidenceIssueSchema = z.object({
  row_id: z.string(),
  severity: z.enum(["warning", "critical"]),
  code: z.enum([
    "missing_identity",
    "retracted_source",
    "missing_evidence_anchor",
    "unanchored_reported_field",
    "fulltext_anchor_not_in_body",
    "abstract_anchor_mismatch",
    "metadata_anchor_mismatch",
    "unsupported_metadata_detail",
    "important_field_not_checked",
  ]),
  message: z.string(),
});

function errorResult(error: unknown) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: publicErrorMessage(error) }],
  };
}

export function createUniPaperServer(dependencies: ScholarlyDependencies = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Resolve the exact paper first. Expand the citation network when broader literature coverage matters, but never infer support or contradiction from a citation link alone. Then check lawful open access. If no OA copy exists, build an institution link only for an adapter the user selects. The user must authenticate in their own browser. Never request credentials, cookies, MFA codes, proxy sessions, or bulk downloads. Never claim full-text access until the user supplies or opens the full article. For multi-paper synthesis, build an evidence matrix only from content actually inspected, preserve exact access labels and locators, and never invent missing fields.",
    },
  );

  server.registerTool(
    "resolve_paper",
    {
      title: "Resolve paper metadata",
      description:
        "Use this to identify a scholarly work by DOI or title before looking for full text or constructing a library link.",
      inputSchema: z.object({
        query: z.string().min(1).max(512).describe("A DOI, DOI URL, or paper title."),
        query_type: z
          .enum(["auto", "doi", "title"])
          .default("auto")
          .describe("Use auto unless the input type is known."),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      outputSchema: z.object({
        query_type: z.enum(["doi", "title"]),
        normalized_query: z.string(),
        provider: z.literal("crossref"),
        matches: z.array(paperMatchSchema),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, query_type, limit }) => {
      try {
        const result = await resolvePaper(query, query_type, limit, dependencies);
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: `Crossref returned ${result.matches.length} metadata match${result.matches.length === 1 ? "" : "es"}.`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "expand_citation_network",
    {
      title: "Expand a paper's citation network",
      description:
        "Use this after resolving a DOI to find bounded sets of influential references, later papers that cite the seed, and topic-similar works. Results are deduplicated. A citation link never proves support or contradiction; inspect citation context or full text before classifying stance.",
      inputSchema: z.object({
        doi: z.string().min(1).max(512).describe("The resolved DOI or DOI URL."),
        per_relation: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Maximum results for each of earlier, later, and similar works."),
      }),
      outputSchema: z.object({
        provider: z.literal("openalex"),
        configured: z.literal(true),
        seed: citationNetworkPaperSchema,
        requested_per_relation: z.number().int(),
        counts: z.object({
          references_reported: z.number().int(),
          references_scanned: z.number().int(),
          citing_works_reported: z.number().int(),
          related_works_reported: z.number().int(),
        }),
        earlier_works: z.array(citationNetworkPaperSchema),
        later_works: z.array(citationNetworkPaperSchema),
        similar_works: z.array(citationNetworkPaperSchema),
        citation_stance: z.literal("not_determined"),
        notes: z.array(z.string()),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ doi, per_relation }) => {
      try {
        const result = await expandCitationNetwork(doi, per_relation, dependencies);
        const returned =
          result.earlier_works.length +
          result.later_works.length +
          result.similar_works.length;
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: `OpenAlex returned ${returned} deduplicated citation-network candidates. Citation stance remains undetermined until context or full text is inspected.`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "find_open_access",
    {
      title: "Find lawful open access",
      description:
        "Use this after resolving a DOI to check whether OpenAlex reports a lawful open-access landing page or PDF.",
      inputSchema: z.object({
        doi: z.string().min(1).max(512).describe("The resolved DOI or DOI URL."),
      }),
      outputSchema: z.object({
        doi: z.string(),
        provider: z.literal("openalex"),
        configured: z.boolean(),
        found: z.boolean(),
        is_open_access: z.boolean().nullable(),
        title: z.string().nullable(),
        year: z.number().int().nullable(),
        is_retracted: z.boolean().nullable(),
        landing_page_url: z.string().nullable(),
        pdf_url: z.string().nullable(),
        source_name: z.string().nullable(),
        license: z.string().nullable(),
        version: z.string().nullable(),
        provider_record_url: z.string().nullable(),
        note: z.string(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ doi }) => {
      try {
        const result = await findOpenAccess(doi, dependencies);
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: result.note,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "build_evidence_matrix",
    {
      title: "Build a multi-paper evidence matrix",
      description:
        "Use this after inspecting two or more papers to deduplicate them, preserve exact full-text/abstract/metadata access labels, render Markdown and CSV comparison tables, and flag unsupported details or missing evidence locations. This tool formats supplied evidence; it does not read papers or verify claims itself.",
      inputSchema: z.object({
        research_question: z.string().min(3).max(1000),
        papers: z.array(evidencePaperInputSchema).min(2).max(30),
      }),
      outputSchema: z.object({
        research_question: z.string(),
        row_count: z.number().int(),
        duplicates_omitted: z.array(
          z.object({
            input_position: z.number().int(),
            title: z.string(),
            duplicate_of: z.string(),
            matched_by: z.enum(["doi", "title_year"]),
          }),
        ),
        rows: z.array(evidenceRowSchema),
        quality_summary: z.object({
          ready_for_synthesis: z.boolean(),
          critical_issues: z.number().int(),
          warnings: z.number().int(),
          fulltext_rows: z.number().int(),
          limited_access_rows: z.number().int(),
          rows_with_anchors: z.number().int(),
        }),
        quality_issues: z.array(evidenceIssueSchema),
        markdown: z.string(),
        csv: z.string(),
        notes: z.array(z.string()),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ research_question, papers }) => {
      try {
        const result = buildEvidenceMatrix({ research_question, papers });
        return {
          structuredContent: { ...result },
          content: [
            {
              type: "text",
              text: `Built an evidence matrix with ${result.row_count} distinct papers. Synthesis readiness: ${result.quality_summary.ready_for_synthesis ? "ready" : "needs evidence fixes"}.`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_institutions",
    {
      title: "List institution adapters",
      description:
        "Use this to see which university library link adapters are supported and to obtain their current access and fair-use guidance.",
      outputSchema: z.object({ institutions: z.array(institutionSchema) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const institutions = listInstitutions();
      return {
        structuredContent: { institutions },
        content: [
          {
            type: "text",
            text: `Found ${institutions.length} institution adapters. Authentication always stays in the user's browser.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "build_institution_link",
    {
      title: "Build institutional access link",
      description:
        "Use this only after the user selects a supported institution and the exact public publisher or repository URL is known. It constructs a link but never opens it or handles authentication.",
      inputSchema: z.object({
        institution_id: z
          .string()
          .min(1)
          .max(100)
          .describe("An ID returned by list_institutions, such as khu-seoul."),
        target_url: z
          .string()
          .min(1)
          .max(4096)
          .describe("The canonical public publisher or repository URL."),
      }),
      outputSchema: z.object({
        institution_id: z.string(),
        institution: z.string(),
        campus: z.string(),
        target_url: z.string(),
        access_url: z.string(),
        authentication: z.literal("user_browser"),
        credentials_handled_by_server: z.literal(false),
        access_guide_url: z.string(),
        fair_use_policy_url: z.string(),
        usage_note: z.string(),
        next_steps: z.array(z.string()),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ institution_id, target_url }) => {
      try {
        const result = buildInstitutionLink(institution_id, target_url);
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: "Institutional link built. The user must open it and sign in directly in their own browser.",
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
