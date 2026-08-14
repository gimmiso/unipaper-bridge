---
name: draft-claim-auditor
description: Audit scholarly drafts sentence by sentence against papers actually inspected, returning conservative SUPPORTED, PARTIAL, CONTRADICTED, or UNVERIFIED verdicts with exact DOI and page/section/table/figure provenance. Use when the user asks to verify citations, fact-check a literature review or manuscript, check whether sentences are really supported by cited papers, find citation overclaiming or contradictions, or review an introduction, methods, results, discussion, thesis, proposal, or article draft against primary sources. Keep unpublished draft text in the local read-only audit MCP; never treat metadata, snippets, or citation edges as direct evidence.
---

# Draft Claim Auditor

Audit prose against evidence already inspected. Perform the semantic comparison
yourself; use `audit_draft_claims` to validate provenance and derive conservative
sentence-level verdicts. The tool does not read papers or decide whether an
anchor supports a claim.

## Preserve the draft exactly

1. Keep the supplied draft unchanged while auditing. Do not silently rewrite it.
2. Segment the requested scope into sentences while preserving exact text.
   Record zero-based UTF-16 `start_offset` and exclusive `end_offset` values so
   `draft_text.slice(start_offset, end_offset)` equals the sentence exactly.
3. Assign stable ASCII IDs such as `S1`, `S2`, `C1`, and `SRC1`. Audit every
   sentence in scope. For prose with no externally verifiable factual claim,
   record an atomic claim explaining that no source-backed proposition was
   found and leave it `UNVERIFIED`; explain separately that a citation may not
   be required.
4. Split each compound sentence into atomic claims. Separate population,
   geography, time, direction, magnitude, causality, mechanism, generalisation,
   and limitation claims when they can fail independently.

## Inspect the evidence before classification

1. Reuse verified DOI, access labels, and exact anchors from
   `build_evidence_matrix` when available. The matrix is an evidence index, not
   a substitute for inspecting the relevant source content.
2. For a missing decisive source, follow `institutional-paper-reader`: resolve
   the exact work, try lawful OA, verify readability, and use the user's local
   institutional fallback only when required. Resume the audit when the lawful
   full text is available.
3. Include only sources actually checked for the atomic claim. Use exact access
   labels: `FULLTEXT-OA`, `FULLTEXT-LICENSED`, `FULLTEXT-USER`,
   `ABSTRACT-ONLY`, or `METADATA-ONLY`.
4. Create concise paraphrased anchors with the exact page, section, paragraph,
   table, figure, or supplement locator. Do not paste long copyrighted passages.
5. Verify DOI identity and retraction status. Never use a citation edge, search
   snippet, title, abstract index entry, or Zotero record as proof that the
   article body supports a claim.

## Compare each atomic claim semantically

For every claim-to-anchor link, assign one relation:

- `SUPPORTS` — same proposition with compatible population, setting, direction,
  magnitude, design, and causal strength.
- `PARTIALLY_SUPPORTS` — only part matches, or the draft is broader/stronger than
  the inspected evidence.
- `CONTRADICTS` — the inspected evidence directly conflicts with the draft's
  direction, magnitude, scope, mechanism, or stated conclusion.

Do not force a link when the inspected source does not address the claim. List
the source in `checked_source_ids` and leave the claim without an evidence link;
the result should remain `UNVERIFIED`.

Pay special attention to common overclaims:

- association rewritten as causation
- one country, subgroup, or time window rewritten as universal evidence
- statistical significance rewritten as practical importance
- a null or mixed result rewritten as no effect
- a model's in-sample result rewritten as external generalisation
- a paper's speculation rewritten as an observed result

## Run the local provenance validator

1. Call the local `audit_draft_claims` tool with the exact draft, sentences,
   atomic claims, inspected sources, anchors, and claim-to-anchor relations.
2. Never send the full unpublished draft to a hosted UniPaper endpoint. The
   audit tool must be the bundled local stdio MCP. If it is unavailable, perform
   the audit transparently in the current conversation and state that the local
   provenance validator was not run.
3. Do not preselect the sentence verdict. Let the tool derive it:
   - all atomic claims directly supported → `SUPPORTED`
   - some support, limited evidence, mixed claims, or source conflict → `PARTIAL`
   - any atomic claim directly contradicted → `CONTRADICTED`
   - no usable inspected anchor → `UNVERIFIED`
4. Direct `SUPPORTED` or `CONTRADICTED` requires a valid DOI, non-retracted
   `FULLTEXT-OA`, `FULLTEXT-LICENSED`, or `FULLTEXT-USER`, and a
   body/table/figure/supplement anchor.
   Abstract evidence is limited to `PARTIAL`; metadata cannot verify a semantic
   claim.
5. If `ready_for_use` is false, resolve critical DOI, retraction, access, or
   locator defects before presenting the audit as final. Never delete a quality
   issue just to obtain a cleaner result.

## Return an actionable audit

Use the returned Markdown as the evidence layer and report, for every sentence:

| Field | Required output |
|---|---|
| Sentence | exact original text and ID |
| Verdict | `SUPPORTED`, `PARTIAL`, `CONTRADICTED`, or `UNVERIFIED` |
| Why | atomic claim results and any overclaim/conflict |
| Source | exact DOI and title |
| Location | page/section/table/figure/supplement |
| Action | retain, narrow/split, rewrite/remove, or find evidence |

Keep paper-reported content separate from your inference. For `PARTIAL`,
`CONTRADICTED`, and `UNVERIFIED`, offer a narrowly corrected sentence only when
the user asks for rewriting or when a concise suggestion materially helps; do
not overwrite the original draft automatically.

After the audit and any requested revision, follow the existing Zotero consent
rules to preserve only the material papers actually used. An audit result never
authorises a Zotero write by itself.
