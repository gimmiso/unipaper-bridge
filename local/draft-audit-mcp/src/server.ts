import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import {
  ACCESS_LEVELS,
  AUDIT_ISSUE_CODES,
  AuditInputError,
  CLAIM_STATUSES,
  EFFECTIVE_RELATIONS,
  EVIDENCE_RELATIONS,
  SOURCE_PARTS,
  auditDraftClaims,
} from "./audit.js";

const idSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._:-]{0,99}$/i)
  .describe("A stable local identifier using ASCII letters, numbers, dots, underscores, colons, or hyphens.");

const sourceAnchorSchema = z.object({
  anchor_id: idSchema,
  source_part: z.enum(SOURCE_PARTS),
  locator: z
    .string()
    .min(1)
    .max(300)
    .describe("Exact page, section, paragraph, table, figure, supplement, or metadata location."),
  evidence_summary: z
    .string()
    .min(1)
    .max(1500)
    .describe("A concise paraphrase of the inspected evidence; do not paste long copyrighted text."),
});

const sourceInputSchema = z.object({
  source_id: idSchema,
  doi: z.string().min(1).max(512).nullable().default(null),
  title: z.string().min(1).max(500),
  access_level: z.enum(ACCESS_LEVELS),
  is_retracted: z.boolean().nullable().default(null),
  anchors: z.array(sourceAnchorSchema).max(30),
});

const claimEvidenceInputSchema = z.object({
  source_id: idSchema,
  anchor_id: idSchema,
  relation: z
    .enum(EVIDENCE_RELATIONS)
    .describe("The caller's semantic comparison between this atomic claim and this exact source anchor."),
  rationale: z.string().min(1).max(1000),
});

const atomicClaimInputSchema = z.object({
  claim_id: idSchema,
  text: z.string().min(1).max(1000),
  checked_source_ids: z.array(idSchema).max(100),
  evidence: z.array(claimEvidenceInputSchema).max(30),
});

const sentenceInputSchema = z.object({
  sentence_id: idSchema,
  text: z.string().min(1).max(4000),
  start_offset: z
    .number()
    .int()
    .min(0)
    .max(200_000)
    .describe("Zero-based UTF-16 start offset into draft_text."),
  end_offset: z
    .number()
    .int()
    .min(1)
    .max(200_000)
    .describe("Exclusive zero-based UTF-16 end offset into draft_text."),
  claims: z.array(atomicClaimInputSchema).min(1).max(10),
});

const auditCitationSchema = z.object({
  source_id: z.string(),
  anchor_id: z.string(),
  doi: z.string().nullable(),
  title: z.string(),
  access_level: z.enum(ACCESS_LEVELS),
  relation: z.enum(EVIDENCE_RELATIONS),
  effective_relation: z.enum(EFFECTIVE_RELATIONS),
  source_part: z.enum(SOURCE_PARTS),
  locator: z.string(),
  evidence_summary: z.string(),
  rationale: z.string(),
  limitation_reason: z.string().nullable(),
});

const issueSchema = z.object({
  sentence_id: z.string(),
  claim_id: z.string().nullable(),
  source_id: z.string().nullable(),
  severity: z.enum(["warning", "critical"]),
  code: z.enum(AUDIT_ISSUE_CODES),
  message: z.string(),
});

const claimResultSchema = z.object({
  claim_id: z.string(),
  text: z.string(),
  status: z.enum(CLAIM_STATUSES),
  evidence_conflict: z.boolean(),
  checked_source_ids: z.array(z.string()),
  citations: z.array(auditCitationSchema),
  issue_codes: z.array(z.enum(AUDIT_ISSUE_CODES)),
});

const sentenceResultSchema = z.object({
  sentence_id: z.string(),
  text: z.string(),
  start_offset: z.number().int(),
  end_offset: z.number().int(),
  status: z.enum(CLAIM_STATUSES),
  claim_results: z.array(claimResultSchema),
  recommended_action: z.string(),
});

function safeErrorResult(error: unknown) {
  const message =
    error instanceof AuditInputError
      ? error.message
      : "The local draft audit could not validate this input packet.";
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

export function createDraftAuditServer(): McpServer {
  const server = new McpServer(
    { name: "unipaper-draft-audit-local", version: "0.1.0" },
    {
      instructions:
        "Audit draft sentences only after the model has inspected the cited sources, split compound sentences into atomic claims, and mapped each semantic relation to an exact evidence anchor. This local tool validates offsets, DOI provenance, access levels, retraction status, and anchor references, then derives conservative sentence statuses. It does not read papers, decide semantic relations, modify drafts, access files, call the network, write to Zotero, or persist draft text.",
    },
  );

  server.registerTool(
    "audit_draft_claims",
    {
      title: "Audit draft claims against inspected papers",
      description:
        "Local, read-only provenance validator for sentence-level citation audits. Supply exact draft offsets, atomic claims, papers already inspected, exact source anchors, and the caller's anchor-level semantic relations. Returns SUPPORTED, PARTIAL, CONTRADICTED, or UNVERIFIED with DOI and page/section/table/figure locations. Direct support or contradiction requires non-retracted full text plus a valid DOI. The tool does not read sources or make the initial semantic judgment itself.",
      inputSchema: z.object({
        draft_text: z
          .string()
          .min(1)
          .max(200_000)
          .describe("The draft text being audited. It remains in this local stdio process."),
        sources: z.array(sourceInputSchema).min(1).max(100),
        sentences: z.array(sentenceInputSchema).min(1).max(250),
      }),
      outputSchema: z.object({
        draft_character_count: z.number().int(),
        sentence_count: z.number().int(),
        source_count: z.number().int(),
        status_counts: z.object({
          SUPPORTED: z.number().int(),
          PARTIAL: z.number().int(),
          CONTRADICTED: z.number().int(),
          UNVERIFIED: z.number().int(),
        }),
        source_anchored_rate: z.number(),
        quality_summary: z.object({
          ready_for_use: z.boolean(),
          critical_issues: z.number().int(),
          warnings: z.number().int(),
        }),
        results: z.array(sentenceResultSchema),
        quality_issues: z.array(issueSchema),
        markdown: z.string(),
        notes: z.array(z.string()),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const result = auditDraftClaims(input);
        return {
          structuredContent: { ...result },
          content: [
            {
              type: "text" as const,
              text: `Audited ${result.sentence_count} draft sentences locally: ${result.status_counts.SUPPORTED} supported, ${result.status_counts.PARTIAL} partial, ${result.status_counts.CONTRADICTED} contradicted, and ${result.status_counts.UNVERIFIED} unverified.`,
            },
          ],
        };
      } catch (error) {
        return safeErrorResult(error);
      }
    },
  );

  return server;
}
