import { normalizeDoi, normalizeTitle } from "./doi.js";
import { UserInputError } from "./errors.js";

export const EVIDENCE_ACCESS_LEVELS = [
  "FULLTEXT-OA",
  "FULLTEXT-USER",
  "ABSTRACT-ONLY",
  "METADATA-ONLY",
] as const;

export const EVIDENCE_FIELD_STATUSES = [
  "reported",
  "not_reported",
  "not_applicable",
  "not_checked",
] as const;

export const EVIDENCE_SOURCE_PARTS = [
  "abstract",
  "main_text",
  "figure",
  "table",
  "supplement",
  "metadata",
] as const;

export const EVIDENCE_FIELD_NAMES = [
  "research_task",
  "setting",
  "sample",
  "data_source",
  "method",
  "evaluation",
  "key_findings",
  "limitations",
] as const;

export type EvidenceAccessLevel = (typeof EVIDENCE_ACCESS_LEVELS)[number];
export type EvidenceFieldStatus = (typeof EVIDENCE_FIELD_STATUSES)[number];
export type EvidenceSourcePart = (typeof EVIDENCE_SOURCE_PARTS)[number];
export type EvidenceFieldName = (typeof EVIDENCE_FIELD_NAMES)[number];

export interface EvidenceFieldValue {
  status: EvidenceFieldStatus;
  value: string | null;
}

export interface EvidenceAnchor {
  claim: string;
  supports: EvidenceFieldName[];
  source_part: EvidenceSourcePart;
  locator: string;
}

export interface EvidenceMatrixPaperInput {
  doi?: string | null;
  title: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  access_level: EvidenceAccessLevel;
  is_retracted?: boolean | null;
  research_task: EvidenceFieldValue;
  setting: EvidenceFieldValue;
  sample: EvidenceFieldValue;
  data_source: EvidenceFieldValue;
  method: EvidenceFieldValue;
  evaluation: EvidenceFieldValue;
  key_findings: EvidenceFieldValue;
  limitations: EvidenceFieldValue;
  evidence_anchors?: EvidenceAnchor[];
  inclusion_reason: string;
}

export interface EvidenceMatrixInput {
  research_question: string;
  papers: EvidenceMatrixPaperInput[];
}

export interface EvidenceMatrixRow
  extends Omit<
    EvidenceMatrixPaperInput,
    "doi" | "authors" | "year" | "venue" | "is_retracted" | "evidence_anchors"
  > {
  row_id: string;
  doi: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  is_retracted: boolean | null;
  evidence_anchors: EvidenceAnchor[];
}

export interface EvidenceMatrixIssue {
  row_id: string;
  severity: "warning" | "critical";
  code:
    | "missing_identity"
    | "retracted_source"
    | "missing_evidence_anchor"
    | "unanchored_reported_field"
    | "fulltext_anchor_not_in_body"
    | "abstract_anchor_mismatch"
    | "metadata_anchor_mismatch"
    | "unsupported_metadata_detail"
    | "important_field_not_checked";
  message: string;
}

export interface EvidenceMatrixDuplicate {
  input_position: number;
  title: string;
  duplicate_of: string;
  matched_by: "doi" | "title_year";
}

export interface EvidenceMatrixResult {
  research_question: string;
  row_count: number;
  duplicates_omitted: EvidenceMatrixDuplicate[];
  rows: EvidenceMatrixRow[];
  quality_summary: {
    ready_for_synthesis: boolean;
    critical_issues: number;
    warnings: number;
    fulltext_rows: number;
    limited_access_rows: number;
    rows_with_anchors: number;
  };
  quality_issues: EvidenceMatrixIssue[];
  markdown: string;
  csv: string;
  notes: string[];
}

const STATUS_LABELS: Record<EvidenceFieldStatus, string> = {
  reported: "",
  not_reported: "Not reported",
  not_applicable: "Not applicable",
  not_checked: "Not checked",
};

const SOURCE_PART_LABELS: Record<EvidenceSourcePart, string> = {
  abstract: "Abstract",
  main_text: "Main text",
  figure: "Figure",
  table: "Table",
  supplement: "Supplement",
  metadata: "Metadata",
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeRequired(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new UserInputError(
      `${label} must be between ${minimum} and ${maximum} characters after whitespace normalization.`,
    );
  }
  return normalized;
}

function validateField(field: EvidenceFieldValue, label: string): EvidenceFieldValue {
  const value = field.value === null ? null : normalizeWhitespace(field.value);
  if (field.status === "reported") {
    if (!value) {
      throw new UserInputError(`${label}.value is required when status is reported.`);
    }
    return { status: field.status, value };
  }
  if (value !== null) {
    throw new UserInputError(`${label}.value must be null when status is ${field.status}.`);
  }
  return { status: field.status, value: null };
}

function normalizePaper(input: EvidenceMatrixPaperInput, rowId: string): EvidenceMatrixRow {
  const normalizedFields = Object.fromEntries(
    EVIDENCE_FIELD_NAMES.map((name) => [
      name,
      validateField(input[name], `${rowId}.${name}`),
    ]),
  ) as Pick<EvidenceMatrixRow, EvidenceFieldName>;
  return {
    row_id: rowId,
    doi: input.doi ? normalizeDoi(input.doi) : null,
    title: normalizeTitle(input.title),
    authors: (input.authors ?? []).map(normalizeWhitespace).filter(Boolean),
    year: input.year ?? null,
    venue: input.venue ? normalizeWhitespace(input.venue) : null,
    access_level: input.access_level,
    is_retracted: input.is_retracted ?? null,
    ...normalizedFields,
    evidence_anchors: (input.evidence_anchors ?? []).map((anchor) => ({
      claim: normalizeRequired(anchor.claim, `${rowId}.evidence_anchors.claim`, 1, 500),
      supports: [...new Set(anchor.supports)],
      source_part: anchor.source_part,
      locator: normalizeRequired(
        anchor.locator,
        `${rowId}.evidence_anchors.locator`,
        1,
        300,
      ),
    })),
    inclusion_reason: normalizeRequired(
      input.inclusion_reason,
      `${rowId}.inclusion_reason`,
      1,
      1000,
    ),
  };
}

function titleYearKey(row: Pick<EvidenceMatrixRow, "title" | "year">): string {
  return `${row.title.toLocaleLowerCase("en-US")}::${row.year ?? "unknown"}`;
}

function qualityIssues(row: EvidenceMatrixRow): EvidenceMatrixIssue[] {
  const issues: EvidenceMatrixIssue[] = [];
  const add = (
    severity: EvidenceMatrixIssue["severity"],
    code: EvidenceMatrixIssue["code"],
    message: string,
  ) => issues.push({ row_id: row.row_id, severity, code, message });
  const reportedFields = EVIDENCE_FIELD_NAMES.filter(
    (name) => row[name].status === "reported",
  );

  if (!row.doi && row.year === null && row.authors.length === 0) {
    add(
      "warning",
      "missing_identity",
      "No DOI, year, or author is present; verify that this row identifies the intended work.",
    );
  }
  if (row.is_retracted) {
    add(
      "critical",
      "retracted_source",
      "The source is marked retracted; do not use it as positive evidence without explicit analysis.",
    );
  }
  if (reportedFields.length > 0 && row.evidence_anchors.length === 0) {
    add(
      "critical",
      "missing_evidence_anchor",
      "Reported study details have no page, section, figure, table, or metadata locator.",
    );
  }
  if (row.evidence_anchors.length > 0) {
    const anchoredFields = new Set(
      row.evidence_anchors.flatMap((anchor) => anchor.supports),
    );
    const unanchoredFields = reportedFields.filter((name) => !anchoredFields.has(name));
    if (unanchoredFields.length > 0) {
      add(
        "critical",
        "unanchored_reported_field",
        `Reported fields lack a mapped evidence location: ${unanchoredFields.join(", ")}.`,
      );
    }
  }

  const sourceParts = new Set(row.evidence_anchors.map((anchor) => anchor.source_part));
  if (
    row.access_level.startsWith("FULLTEXT-") &&
    row.evidence_anchors.length > 0 &&
    [...sourceParts].every((part) => part === "abstract" || part === "metadata")
  ) {
    add(
      "critical",
      "fulltext_anchor_not_in_body",
      "The row is labelled full text, but every evidence anchor points only to the abstract or metadata.",
    );
  }
  if (
    row.access_level === "ABSTRACT-ONLY" &&
    [...sourceParts].some((part) => part !== "abstract" && part !== "metadata")
  ) {
    add(
      "critical",
      "abstract_anchor_mismatch",
      "An ABSTRACT-ONLY row cannot cite main-text, figure, table, or supplement locations.",
    );
  }
  if (
    row.access_level === "METADATA-ONLY" &&
    [...sourceParts].some((part) => part !== "metadata")
  ) {
    add(
      "critical",
      "metadata_anchor_mismatch",
      "A METADATA-ONLY row can cite metadata locations only.",
    );
  }
  if (row.access_level === "METADATA-ONLY" && reportedFields.length > 0) {
    add(
      "critical",
      "unsupported_metadata_detail",
      `METADATA-ONLY cannot substantiate reported study details (${reportedFields.join(", ")}).`,
    );
  }

  const importantNotChecked = ["method", "key_findings", "limitations"].filter(
    (name) => row[name as "method" | "key_findings" | "limitations"].status === "not_checked",
  );
  if (importantNotChecked.length > 0) {
    add(
      "warning",
      "important_field_not_checked",
      `Important comparison fields remain unchecked: ${importantNotChecked.join(", ")}.`,
    );
  }
  return issues;
}

function renderField(field: EvidenceFieldValue): string {
  return field.status === "reported" ? field.value ?? "" : STATUS_LABELS[field.status];
}

function markdownCell(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function csvCell(value: string | number | null): string {
  const raw = value === null ? "" : String(value);
  const text = /^[\t ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function citation(row: EvidenceMatrixRow): string {
  const authors = row.authors.length > 0 ? row.authors.join("; ") : "Author unknown";
  const year = row.year ?? "n.d.";
  const venue = row.venue ? ` ${row.venue}.` : "";
  const doi = row.doi ? ` https://doi.org/${row.doi}` : "";
  return `${authors} (${year}). ${row.title}.${venue}${doi}`;
}

function anchors(row: EvidenceMatrixRow): string {
  if (row.evidence_anchors.length === 0) return "No locator supplied";
  return row.evidence_anchors
    .map(
      (anchor) =>
        `[${anchor.supports.join(", ")}] ${anchor.claim} — ${SOURCE_PART_LABELS[anchor.source_part]}: ${anchor.locator}`,
    )
    .join("; ");
}

function buildMarkdown(
  researchQuestion: string,
  rows: EvidenceMatrixRow[],
  issues: EvidenceMatrixIssue[],
): string {
  const header = [
    "| ID | Paper | Access | Task | Setting · sample | Data | Method · evaluation | Key findings | Limitations | Evidence location |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  const body = rows.map((row) =>
    [
      row.row_id,
      citation(row),
      row.access_level,
      renderField(row.research_task),
      `${renderField(row.setting)} · ${renderField(row.sample)}`,
      renderField(row.data_source),
      `${renderField(row.method)} · ${renderField(row.evaluation)}`,
      renderField(row.key_findings),
      renderField(row.limitations),
      anchors(row),
    ]
      .map(markdownCell)
      .join(" | ")
      .replace(/^/, "| ")
      .replace(/$/, " |"),
  );
  const quality =
    issues.length === 0
      ? ["- No structural evidence-quality issues detected."]
      : issues.map(
          (issue) =>
            `- **${issue.severity.toUpperCase()} ${issue.row_id}** (${issue.code}): ${issue.message}`,
        );
  return [
    "## Evidence matrix",
    "",
    `Research question: ${researchQuestion}`,
    "",
    ...header,
    ...body,
    "",
    "### Quality checks",
    "",
    ...quality,
  ].join("\n");
}

function buildCsv(rows: EvidenceMatrixRow[]): string {
  const columns = [
    "ID",
    "DOI",
    "Title",
    "Authors",
    "Year",
    "Venue",
    "Access",
    "Retracted",
    "Research task",
    "Setting",
    "Sample",
    "Data source",
    "Method",
    "Evaluation",
    "Key findings",
    "Limitations",
    "Evidence locations",
    "Inclusion reason",
  ];
  const lines = rows.map((row) => [
    row.row_id,
    row.doi,
    row.title,
    row.authors.join("; "),
    row.year,
    row.venue,
    row.access_level,
    row.is_retracted === null ? "unknown" : String(row.is_retracted),
    renderField(row.research_task),
    renderField(row.setting),
    renderField(row.sample),
    renderField(row.data_source),
    renderField(row.method),
    renderField(row.evaluation),
    renderField(row.key_findings),
    renderField(row.limitations),
    anchors(row),
    row.inclusion_reason,
  ]);
  return [columns, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n");
}

export function buildEvidenceMatrix(input: EvidenceMatrixInput): EvidenceMatrixResult {
  const researchQuestion = normalizeRequired(
    input.research_question,
    "research_question",
    3,
    1000,
  );
  if (input.papers.length < 2 || input.papers.length > 30) {
    throw new UserInputError("papers must contain between 2 and 30 papers.");
  }
  const rows: EvidenceMatrixRow[] = [];
  const duplicates: EvidenceMatrixDuplicate[] = [];
  const doiToRow = new Map<string, string>();
  const titleToRow = new Map<string, Pick<EvidenceMatrixRow, "row_id" | "doi">>();

  for (const [index, paper] of input.papers.entries()) {
    const candidate = normalizePaper(paper, `E${rows.length + 1}`);
    const titleKey = titleYearKey(candidate);
    const doiDuplicate = candidate.doi ? doiToRow.get(candidate.doi) : undefined;
    const titleMatch = titleToRow.get(titleKey);
    const titleDuplicate =
      titleMatch && (!candidate.doi || !titleMatch.doi) ? titleMatch.row_id : undefined;
    const duplicateOf = doiDuplicate ?? titleDuplicate;
    if (duplicateOf) {
      duplicates.push({
        input_position: index + 1,
        title: candidate.title,
        duplicate_of: duplicateOf,
        matched_by: doiDuplicate ? "doi" : "title_year",
      });
      continue;
    }
    rows.push(candidate);
    if (candidate.doi) doiToRow.set(candidate.doi, candidate.row_id);
    titleToRow.set(titleKey, { row_id: candidate.row_id, doi: candidate.doi });
  }

  if (rows.length < 2) {
    throw new UserInputError(
      "At least two distinct papers are required after DOI/title-year deduplication.",
    );
  }

  const issues = rows.flatMap(qualityIssues);
  const criticalIssues = issues.filter((issue) => issue.severity === "critical").length;
  const warnings = issues.length - criticalIssues;
  return {
    research_question: researchQuestion,
    row_count: rows.length,
    duplicates_omitted: duplicates,
    rows,
    quality_summary: {
      ready_for_synthesis: criticalIssues === 0,
      critical_issues: criticalIssues,
      warnings,
      fulltext_rows: rows.filter((row) => row.access_level.startsWith("FULLTEXT-")).length,
      limited_access_rows: rows.filter(
        (row) => row.access_level === "ABSTRACT-ONLY" || row.access_level === "METADATA-ONLY",
      ).length,
      rows_with_anchors: rows.filter((row) => row.evidence_anchors.length > 0).length,
    },
    quality_issues: issues,
    markdown: buildMarkdown(researchQuestion, rows, issues),
    csv: buildCsv(rows),
    notes: [
      "This tool validates and formats evidence supplied by the caller; it does not read papers or verify the claims itself.",
      "Do not infer missing values. Keep not_reported, not_applicable, and not_checked distinct.",
      "Use evidence locations that point to the inspected abstract, page, section, figure, table, supplement, or metadata record.",
      "Zotero persistence is a separate final step after synthesis and material-source selection.",
    ],
  };
}
