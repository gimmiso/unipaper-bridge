export const CLAIM_STATUSES = [
  "SUPPORTED",
  "PARTIAL",
  "CONTRADICTED",
  "UNVERIFIED",
] as const;

export const ACCESS_LEVELS = [
  "FULLTEXT-OA",
  "FULLTEXT-USER",
  "ABSTRACT-ONLY",
  "METADATA-ONLY",
] as const;

export const SOURCE_PARTS = [
  "abstract",
  "main_text",
  "figure",
  "table",
  "supplement",
  "metadata",
] as const;

export const EVIDENCE_RELATIONS = [
  "SUPPORTS",
  "PARTIALLY_SUPPORTS",
  "CONTRADICTS",
] as const;

export const EFFECTIVE_RELATIONS = [
  "SUPPORTS",
  "PARTIALLY_SUPPORTS",
  "CONTRADICTS",
  "LIMITED",
  "UNUSABLE",
] as const;

export const AUDIT_ISSUE_CODES = [
  "missing_doi",
  "retracted_source",
  "retraction_status_unknown",
  "abstract_only_evidence",
  "abstract_anchor_cannot_directly_verify",
  "access_anchor_mismatch",
  "metadata_cannot_verify_claim",
  "conflicting_evidence",
  "no_sources_checked",
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export type SourcePart = (typeof SOURCE_PARTS)[number];
export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];
export type EffectiveRelation = (typeof EFFECTIVE_RELATIONS)[number];
export type AuditIssueCode = (typeof AUDIT_ISSUE_CODES)[number];

export interface SourceAnchorInput {
  anchor_id: string;
  source_part: SourcePart;
  locator: string;
  evidence_summary: string;
}

export interface AuditSourceInput {
  source_id: string;
  doi?: string | null;
  title: string;
  access_level: AccessLevel;
  is_retracted?: boolean | null;
  anchors: SourceAnchorInput[];
}

export interface ClaimEvidenceInput {
  source_id: string;
  anchor_id: string;
  relation: EvidenceRelation;
  rationale: string;
}

export interface AtomicClaimInput {
  claim_id: string;
  text: string;
  checked_source_ids: string[];
  evidence: ClaimEvidenceInput[];
}

export interface DraftSentenceInput {
  sentence_id: string;
  text: string;
  start_offset: number;
  end_offset: number;
  claims: AtomicClaimInput[];
}

export interface DraftAuditInput {
  draft_text: string;
  sources: AuditSourceInput[];
  sentences: DraftSentenceInput[];
}

export interface AuditCitation {
  source_id: string;
  anchor_id: string;
  doi: string | null;
  title: string;
  access_level: AccessLevel;
  relation: EvidenceRelation;
  effective_relation: EffectiveRelation;
  source_part: SourcePart;
  locator: string;
  evidence_summary: string;
  rationale: string;
  limitation_reason: string | null;
}

export interface AuditIssue {
  sentence_id: string;
  claim_id: string | null;
  source_id: string | null;
  severity: "warning" | "critical";
  code: AuditIssueCode;
  message: string;
}

export interface ClaimAuditResult {
  claim_id: string;
  text: string;
  status: ClaimStatus;
  evidence_conflict: boolean;
  checked_source_ids: string[];
  citations: AuditCitation[];
  issue_codes: AuditIssueCode[];
}

export interface SentenceAuditResult {
  sentence_id: string;
  text: string;
  start_offset: number;
  end_offset: number;
  status: ClaimStatus;
  claim_results: ClaimAuditResult[];
  recommended_action: string;
}

export interface DraftAuditResult {
  draft_character_count: number;
  sentence_count: number;
  source_count: number;
  status_counts: Record<ClaimStatus, number>;
  source_anchored_rate: number;
  quality_summary: {
    ready_for_use: boolean;
    critical_issues: number;
    warnings: number;
  };
  results: SentenceAuditResult[];
  quality_issues: AuditIssue[];
  markdown: string;
  notes: string[];
}

export class AuditInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditInputError";
  }
}

const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,99}$/i;

function normalizeDoi(input: string): string {
  let value = input.trim().replace(/^doi:\s*/i, "");
  try {
    const candidate = new URL(value);
    if (["doi.org", "dx.doi.org"].includes(candidate.hostname.toLowerCase())) {
      value = candidate.pathname.replace(/^\//, "");
    }
  } catch {
    value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  }
  try {
    value = decodeURIComponent(value);
  } catch {
    throw new AuditInputError("A source DOI contains invalid percent encoding.");
  }
  if (!DOI_PATTERN.test(value)) {
    throw new AuditInputError("A source DOI is not valid.");
  }
  return value.toLowerCase();
}

function normalizeRequired(value: string, label: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new AuditInputError(`${label} must be between 1 and ${maximum} characters.`);
  }
  if (/\p{Cc}/u.test(normalized)) {
    throw new AuditInputError(`${label} contains unsupported control characters.`);
  }
  return normalized;
}

function normalizeId(value: string, label: string): string {
  const normalized = value.trim();
  if (!ID_PATTERN.test(normalized)) {
    throw new AuditInputError(
      `${label} must use 1-100 ASCII letters, numbers, dots, underscores, colons, or hyphens.`,
    );
  }
  return normalized;
}

function uniqueIds(values: string[], label: string): string[] {
  const normalized = values.map((value) => normalizeId(value, label));
  return [...new Set(normalized)];
}

function markdownCell(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function recommendedAction(status: ClaimStatus): string {
  switch (status) {
    case "SUPPORTED":
      return "Retain the claim and verify the final citation style.";
    case "PARTIAL":
      return "Narrow or split the sentence so every retained clause matches its evidence.";
    case "CONTRADICTED":
      return "Rewrite or remove the conflicting claim before using the citation.";
    case "UNVERIFIED":
      return "Locate a direct source anchor or remove/qualify the unsupported claim.";
  }
}

function sentenceStatus(claims: ClaimAuditResult[]): ClaimStatus {
  if (claims.some((claim) => claim.status === "CONTRADICTED")) return "CONTRADICTED";
  if (claims.every((claim) => claim.status === "SUPPORTED")) return "SUPPORTED";
  if (claims.some((claim) => claim.status === "SUPPORTED" || claim.status === "PARTIAL")) {
    return "PARTIAL";
  }
  return "UNVERIFIED";
}

function claimStatus(citations: AuditCitation[]): {
  status: ClaimStatus;
  conflict: boolean;
} {
  const hasSupport = citations.some(
    (citation) => citation.effective_relation === "SUPPORTS",
  );
  const hasPartial = citations.some(
    (citation) =>
      citation.effective_relation === "PARTIALLY_SUPPORTS" ||
      citation.effective_relation === "LIMITED",
  );
  const hasContradiction = citations.some(
    (citation) => citation.effective_relation === "CONTRADICTS",
  );
  const conflict = hasContradiction && (hasSupport || hasPartial);
  if (conflict) return { status: "PARTIAL", conflict: true };
  if (hasContradiction) return { status: "CONTRADICTED", conflict: false };
  if (hasSupport) return { status: "SUPPORTED", conflict: false };
  if (hasPartial) return { status: "PARTIAL", conflict: false };
  return { status: "UNVERIFIED", conflict: false };
}

function markdownReport(results: SentenceAuditResult[], issues: AuditIssue[]): string {
  const lines = [
    "## Draft claim audit",
    "",
    "| ID | Draft sentence | Status | Atomic claims | DOI and exact locations | Recommended action |",
    "|---|---|---|---|---|---|",
  ];
  for (const sentence of results) {
    const claims = sentence.claim_results
      .map((claim) => `${claim.claim_id}: ${claim.status}`)
      .join("; ");
    const citations = sentence.claim_results
      .flatMap((claim) => claim.citations)
      .filter((citation) => citation.effective_relation !== "UNUSABLE")
      .map(
        (citation) =>
          `${citation.doi ?? "DOI missing"} — ${citation.source_part}: ${citation.locator}`,
      );
    const uniqueCitations = [...new Set(citations)].join("; ") || "No usable source anchor";
    lines.push(
      [
        sentence.sentence_id,
        sentence.text,
        sentence.status,
        claims,
        uniqueCitations,
        sentence.recommended_action,
      ]
        .map(markdownCell)
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("", "### Quality checks", "");
  if (issues.length === 0) {
    lines.push("- No structural provenance issues detected.");
  } else {
    for (const issue of issues) {
      lines.push(
        `- **${issue.severity.toUpperCase()} ${issue.sentence_id}** (${issue.code}): ${issue.message}`,
      );
    }
  }
  return lines.join("\n");
}

export function auditDraftClaims(input: DraftAuditInput): DraftAuditResult {
  if (input.draft_text.length === 0 || input.draft_text.length > 200_000) {
    throw new AuditInputError("draft_text must contain between 1 and 200000 characters.");
  }
  if (input.sources.length < 1 || input.sources.length > 100) {
    throw new AuditInputError("sources must contain between 1 and 100 papers.");
  }
  if (input.sentences.length < 1 || input.sentences.length > 250) {
    throw new AuditInputError("sentences must contain between 1 and 250 entries.");
  }

  const sources = new Map<
    string,
    Omit<AuditSourceInput, "doi" | "source_id" | "title" | "is_retracted"> & {
      source_id: string;
      doi: string | null;
      title: string;
      is_retracted: boolean | null;
      anchor_map: Map<string, SourceAnchorInput>;
    }
  >();
  for (const rawSource of input.sources) {
    const sourceId = normalizeId(rawSource.source_id, "source_id");
    if (sources.has(sourceId)) throw new AuditInputError(`Duplicate source_id '${sourceId}'.`);
    const anchors: SourceAnchorInput[] = [];
    const anchorMap = new Map<string, SourceAnchorInput>();
    for (const rawAnchor of rawSource.anchors) {
      const anchorId = normalizeId(rawAnchor.anchor_id, `${sourceId}.anchor_id`);
      if (anchorMap.has(anchorId)) {
        throw new AuditInputError(`Duplicate anchor_id '${anchorId}' in source '${sourceId}'.`);
      }
      const anchor = {
        anchor_id: anchorId,
        source_part: rawAnchor.source_part,
        locator: normalizeRequired(rawAnchor.locator, `${sourceId}.${anchorId}.locator`, 300),
        evidence_summary: normalizeRequired(
          rawAnchor.evidence_summary,
          `${sourceId}.${anchorId}.evidence_summary`,
          1500,
        ),
      };
      anchors.push(anchor);
      anchorMap.set(anchorId, anchor);
    }
    sources.set(sourceId, {
      source_id: sourceId,
      doi: rawSource.doi ? normalizeDoi(rawSource.doi) : null,
      title: normalizeRequired(rawSource.title, `${sourceId}.title`, 500),
      access_level: rawSource.access_level,
      is_retracted: rawSource.is_retracted ?? null,
      anchors,
      anchor_map: anchorMap,
    });
  }

  const sentenceIds = new Set<string>();
  const claimIds = new Set<string>();
  const issues: AuditIssue[] = [];
  const issueKeys = new Set<string>();
  const addIssue = (issue: AuditIssue) => {
    const key = [
      issue.sentence_id,
      issue.claim_id ?? "",
      issue.source_id ?? "",
      issue.code,
    ].join("::");
    if (!issueKeys.has(key)) {
      issueKeys.add(key);
      issues.push(issue);
    }
  };
  const results: SentenceAuditResult[] = [];

  for (const rawSentence of input.sentences) {
    const sentenceId = normalizeId(rawSentence.sentence_id, "sentence_id");
    if (sentenceIds.has(sentenceId)) {
      throw new AuditInputError(`Duplicate sentence_id '${sentenceId}'.`);
    }
    sentenceIds.add(sentenceId);
    if (
      rawSentence.start_offset < 0 ||
      rawSentence.end_offset <= rawSentence.start_offset ||
      rawSentence.end_offset > input.draft_text.length ||
      input.draft_text.slice(rawSentence.start_offset, rawSentence.end_offset) !==
        rawSentence.text
    ) {
      throw new AuditInputError(
        `Sentence '${sentenceId}' offsets do not exactly match draft_text.`,
      );
    }
    if (rawSentence.claims.length < 1 || rawSentence.claims.length > 10) {
      throw new AuditInputError(
        `Sentence '${sentenceId}' must contain between 1 and 10 atomic claims.`,
      );
    }

    const claimResults: ClaimAuditResult[] = [];
    for (const rawClaim of rawSentence.claims) {
      const claimId = normalizeId(rawClaim.claim_id, `${sentenceId}.claim_id`);
      if (claimIds.has(claimId)) throw new AuditInputError(`Duplicate claim_id '${claimId}'.`);
      claimIds.add(claimId);
      const checkedSourceIds = uniqueIds(
        rawClaim.checked_source_ids,
        `${claimId}.checked_source_ids`,
      );
      for (const sourceId of checkedSourceIds) {
        if (!sources.has(sourceId)) {
          throw new AuditInputError(
            `Claim '${claimId}' references unknown checked source '${sourceId}'.`,
          );
        }
      }
      if (checkedSourceIds.length === 0) {
        addIssue({
          sentence_id: sentenceId,
          claim_id: claimId,
          source_id: null,
          severity: "warning",
          code: "no_sources_checked",
          message: "No source was recorded as inspected for this atomic claim.",
        });
      }

      const citations: AuditCitation[] = [];
      for (const rawEvidence of rawClaim.evidence) {
        const sourceId = normalizeId(rawEvidence.source_id, `${claimId}.source_id`);
        const anchorId = normalizeId(rawEvidence.anchor_id, `${claimId}.anchor_id`);
        if (!checkedSourceIds.includes(sourceId)) {
          throw new AuditInputError(
            `Claim '${claimId}' uses evidence from source '${sourceId}' without listing it in checked_source_ids.`,
          );
        }
        const source = sources.get(sourceId);
        if (!source) {
          throw new AuditInputError(
            `Claim '${claimId}' references unknown source '${sourceId}'.`,
          );
        }
        const anchor = source.anchor_map.get(anchorId);
        if (!anchor) {
          throw new AuditInputError(
            `Claim '${claimId}' references unknown anchor '${anchorId}' in source '${sourceId}'.`,
          );
        }

        let effectiveRelation: EffectiveRelation = rawEvidence.relation;
        let limitationReason: string | null = null;
        if (source.is_retracted) {
          effectiveRelation = "UNUSABLE";
          limitationReason = "The source is marked retracted.";
          addIssue({
            sentence_id: sentenceId,
            claim_id: claimId,
            source_id: sourceId,
            severity: "critical",
            code: "retracted_source",
            message: "Retracted evidence was excluded from the claim status.",
          });
        } else if (anchor.source_part === "metadata" || source.access_level === "METADATA-ONLY") {
          effectiveRelation = "UNUSABLE";
          limitationReason = "Metadata cannot substantiate a semantic draft claim.";
          addIssue({
            sentence_id: sentenceId,
            claim_id: claimId,
            source_id: sourceId,
            severity: "critical",
            code: "metadata_cannot_verify_claim",
            message: "Metadata-only evidence was excluded from the claim status.",
          });
        } else if (
          source.access_level === "ABSTRACT-ONLY" &&
          anchor.source_part !== "abstract"
        ) {
          effectiveRelation = "UNUSABLE";
          limitationReason = "The locator is incompatible with ABSTRACT-ONLY access.";
          addIssue({
            sentence_id: sentenceId,
            claim_id: claimId,
            source_id: sourceId,
            severity: "critical",
            code: "access_anchor_mismatch",
            message: "An abstract-only source cannot cite a body, table, figure, or supplement anchor.",
          });
        } else if (
          source.access_level === "ABSTRACT-ONLY" ||
          anchor.source_part === "abstract"
        ) {
          effectiveRelation = "LIMITED";
          limitationReason = "Abstract evidence cannot establish a direct full-text verdict.";
          addIssue({
            sentence_id: sentenceId,
            claim_id: claimId,
            source_id: sourceId,
            severity: "warning",
            code:
              source.access_level === "ABSTRACT-ONLY"
                ? "abstract_only_evidence"
                : "abstract_anchor_cannot_directly_verify",
            message: "Abstract evidence was limited to a PARTIAL claim assessment.",
          });
        } else if (!source.doi) {
          effectiveRelation = "LIMITED";
          limitationReason = "The source lacks the exact DOI required for a direct verdict.";
          addIssue({
            sentence_id: sentenceId,
            claim_id: claimId,
            source_id: sourceId,
            severity: "critical",
            code: "missing_doi",
            message: "Evidence without an exact DOI was limited to a PARTIAL assessment.",
          });
        }
        if (source.is_retracted === null) {
          addIssue({
            sentence_id: sentenceId,
            claim_id: claimId,
            source_id: sourceId,
            severity: "warning",
            code: "retraction_status_unknown",
            message: "The source retraction status was not supplied.",
          });
        }

        citations.push({
          source_id: sourceId,
          anchor_id: anchorId,
          doi: source.doi,
          title: source.title,
          access_level: source.access_level,
          relation: rawEvidence.relation,
          effective_relation: effectiveRelation,
          source_part: anchor.source_part,
          locator: anchor.locator,
          evidence_summary: anchor.evidence_summary,
          rationale: normalizeRequired(
            rawEvidence.rationale,
            `${claimId}.evidence.rationale`,
            1000,
          ),
          limitation_reason: limitationReason,
        });
      }

      const derived = claimStatus(citations);
      if (derived.conflict) {
        addIssue({
          sentence_id: sentenceId,
          claim_id: claimId,
          source_id: null,
          severity: "warning",
          code: "conflicting_evidence",
          message: "Usable supporting and contradicting evidence both apply to this claim.",
        });
      }
      claimResults.push({
        claim_id: claimId,
        text: normalizeRequired(rawClaim.text, `${claimId}.text`, 1000),
        status: derived.status,
        evidence_conflict: derived.conflict,
        checked_source_ids: checkedSourceIds,
        citations,
        issue_codes: issues
          .filter(
            (issue) =>
              issue.sentence_id === sentenceId && issue.claim_id === claimId,
          )
          .map((issue) => issue.code),
      });
    }

    const status = sentenceStatus(claimResults);
    results.push({
      sentence_id: sentenceId,
      text: rawSentence.text,
      start_offset: rawSentence.start_offset,
      end_offset: rawSentence.end_offset,
      status,
      claim_results: claimResults,
      recommended_action: recommendedAction(status),
    });
  }

  const statusCounts: Record<ClaimStatus, number> = {
    SUPPORTED: 0,
    PARTIAL: 0,
    CONTRADICTED: 0,
    UNVERIFIED: 0,
  };
  for (const result of results) statusCounts[result.status] += 1;
  const sourceAnchored = results.length - statusCounts.UNVERIFIED;
  const criticalIssues = issues.filter((issue) => issue.severity === "critical").length;

  return {
    draft_character_count: input.draft_text.length,
    sentence_count: results.length,
    source_count: sources.size,
    status_counts: statusCounts,
    source_anchored_rate: Number(((sourceAnchored / results.length) * 100).toFixed(1)),
    quality_summary: {
      ready_for_use: criticalIssues === 0,
      critical_issues: criticalIssues,
      warnings: issues.length - criticalIssues,
    },
    results,
    quality_issues: issues,
    markdown: markdownReport(results, issues),
    notes: [
      "The caller performs semantic comparison after inspecting sources; this local tool validates provenance and derives conservative sentence-level statuses.",
      "SUPPORTED and CONTRADICTED require a valid DOI plus a non-retracted FULLTEXT-OA or FULLTEXT-USER body, table, figure, or supplement anchor.",
      "Abstract-only evidence is limited to PARTIAL, and metadata-only evidence cannot verify a semantic claim.",
      "The tool is local, read-only, stateless, and performs no network, file, Zotero, or credential operation.",
    ],
  };
}
