---
name: academic-novelty-auditor
description: Audit whether a research idea, thesis question, method, or claimed contribution is genuinely novel using adversarial literature discovery, citation-context checking, lawful full-text access, and evidence-matrix comparison. Use when the user asks whether a study has already been done, wants a research gap or novelty claim tested, needs thesis positioning, literature review coverage, closest-paper comparison, or a reviewer-style novelty challenge. Prefer Elicit for broad structured discovery, Scite for citation-context and contradiction checks, UniPaper Bridge/institutional-paper-reader for lawful full-text access including KHU, and Zotero for the user's verified reference library when those tools are available. Never declare novelty from abstracts alone when the closest competing papers can be checked in full text.
---

# Academic Novelty Auditor

Run an adversarial, evidence-first novelty audit. The goal is not to prove that the user's idea is new. The goal is to try to falsify the novelty claim and report what survives.

## Non-negotiable rules

1. Do not equate a new dataset, newer year, larger sample, more countries, or a new application area with methodological novelty unless the contribution depends on it.
2. Do not use `first study`, `never studied`, `unprecedented`, or equivalent language without exceptionally strong coverage and explicit caveats.
3. Do not conclude `DEFENSIBLE NOVELTY` from metadata or abstracts alone when one or more close competitors remain unresolved.
4. For the closest competing papers that materially determine the verdict, inspect full text whenever a lawful copy can be obtained.
5. Distinguish what was actually read from what was inferred. Every paper used in the final verdict must carry an access label.
6. Search adversarially: actively look for papers that would invalidate or narrow the user's contribution.
7. Separate novelty from importance. A question can be new but weak, or important but already studied.
8. Separate conceptual novelty, methodological novelty, empirical novelty, data novelty, and validation novelty.

## Tool order

Use the strongest available tool for each stage. Do not pretend an unavailable connector was used.

1. **Elicit or equivalent structured scholarly search** — broad candidate discovery, screening, paper-level field extraction, evidence tables.
2. **Scite or equivalent citation-context database** — supporting/contrasting citation context, downstream challenges, retractions/editorial concerns, and citation chasing.
3. **Primary scholarly sources and publisher/index pages** — DOI verification, publication status, venue, final version, recent papers and preprints.
4. **UniPaper Bridge / `institutional-paper-reader`** — lawful full-text access.
   Prefer OA first. When a decisive paper remains unreadable, let the reader
   automatically invoke `open_khu_paper` as the last-mile KHU fallback instead
   of asking the user to choose or name the tool. Keep authentication entirely
   in the user's browser. Never request or store university credentials, MFA,
   cookies, or session tokens.
5. **User-provided PDF/full text** — once the user lawfully obtains an individual paper, analyse Methods, Results, figures/tables, Supplement, Discussion, and Limitations as needed. Abstract-only review is not a substitute.
6. **Zotero** — use the user's library as the persistent reference source when available. Search it before duplicating work. When the user's automatic-save preference is enabled or the current prompt explicitly authorises Zotero writes, save every paper that materially affects the verdict, including closest competitors, reused methods or datasets, and decisive contradictory evidence. Follow `institutional-paper-reader` for DOI-first deduplication and OA/user-PDF attachment rules. Do not save rejected screening candidates or redistribute licensed PDFs.

If Elicit or Scite is unavailable, continue with scholarly web search and primary sources rather than stopping. If institutional access is unavailable, mark the unresolved evidence clearly.

## Access labels

Assign exactly one evidence-access label to every paper that appears in the final comparison:

- `FULLTEXT-OA` — lawful open-access full text inspected.
- `FULLTEXT-USER` — full text supplied by the user after lawful access, including KHU/library access.
- `ABSTRACT-ONLY` — abstract inspected but full text not available.
- `METADATA-ONLY` — bibliographic metadata only.

Never write `FULLTEXT` unless the paper body was actually inspected.

## Workflow

### 1. Decompose the claimed contribution

Rewrite the idea into atomic claims before searching. At minimum identify:

- task/problem
- domain/application
- data unit and scale
- model/method
- training or adaptation regime
- shift/generalisation setting
- evaluation target
- proposed mechanism or predictor
- claimed practical/scientific contribution

Do not search only the user's exact phrasing. Generate synonyms, older terminology, adjacent disciplines, and method-equivalent formulations.

### 2. Define the novelty threat model

List what would count as a serious overlap. Include at least:

- same task + same mechanism
- same method under different terminology
- same research question with a different dataset/domain
- adjacent-field method that transfers directly
- benchmark/review paper showing the question is already established
- recent preprint that predates submission even if not yet peer-reviewed

### 3. Broad discovery

Search multiple query families rather than one long query:

- direct formulation
- synonym formulation
- method-first formulation
- task-first formulation
- adjacent-field formulation
- negative/adversarial formulation such as `predict`, `estimate`, `without labels`, `cross-domain`, `distribution shift`, `transfer`, `selective prediction`, `calibration`, or domain-specific equivalents when relevant

Record search date and databases/tools used.

### 4. Screen and cluster

Classify candidates into:

- direct competitor
- partial overlap
- enabling/methodological precedent
- benchmark/review
- background only
- irrelevant after inspection

Prioritise direct competitors and methodological precedents for full-text retrieval.

### 5. Citation-context and backward/forward chasing

For the strongest candidates:

- inspect references for earlier versions of the idea
- inspect citing papers for extensions, replications, contradictions, and criticism
- check whether a newer paper already closes the claimed gap
- verify preprint vs peer-reviewed/version-of-record status

Use Scite when available, but verify critical claims against the underlying papers.

### 6. Full-text gate

The final novelty verdict must not be locked until the papers most likely to invalidate the contribution have been inspected in full text when lawful access is reasonably available.

At minimum, identify the **top three closest competitors**. For each, inspect as available:

- research question/hypothesis
- dataset and sampling unit
- model and training protocol
- baselines
- experimental design
- validation split and shift setting
- metrics
- main results
- limitations
- stated contribution
- exact difference from the user's proposed study

If one of the top three remains `ABSTRACT-ONLY` or `METADATA-ONLY` and could plausibly invalidate the contribution, mark the novelty verdict `PROVISIONAL` and state the unresolved risk. Do not give a high-confidence GO.

### 7. Use KHU/UniPaper Bridge correctly

When a relevant paper is paywalled and `institutional-paper-reader` is available:

1. Resolve the exact DOI/title.
2. Check lawful OA first.
3. Confirm that the article body is actually unreadable; an abstract or landing
   page is not full text.
4. If no suitable OA copy is readable and full text affects the verdict,
   automatically call `open_khu_paper` when available. Ask the campus once only
   if the adapter cannot otherwise be selected.
5. If the local opener is unavailable, construct the supported institution link
   as the manual fallback.
6. The user completes any unavoidable browser interaction and privately attaches
   the individually obtained PDF. Do not ask them to repeat the audit request.
7. Analyse the attached paper, relabel it `FULLTEXT-USER`, and resume the audit
   from the blocked competitor.

Never claim that UniPaper Bridge inherited the user's browser session or downloaded the licensed PDF on the user's behalf.

### 8. Build the evidence matrix

For every paper that materially affects the verdict, capture:

| Field | Required content |
|---|---|
| Citation | Authors, year, title, venue, DOI |
| Access | one access label |
| Task | research task |
| Data | dataset/domain/sample unit |
| Method | model/method |
| Shift/setting | geographic, temporal, domain, OOD, etc. |
| Evaluation | metrics and validation design |
| Contribution | what the paper actually claims |
| Overlap | exact overlap with the proposed study |
| Difference | substantive difference, not cosmetic wording |
| Threat level | HIGH / MEDIUM / LOW |

### 9. Verdict

Use one of four substantive verdicts:

- `ALREADY DONE` — the core contribution is substantially present in prior work.
- `HIGH OVERLAP` — novelty is too narrow or cosmetic unless the question/design is reframed.
- `PARTIAL OVERLAP` — meaningful precedent exists, but a defensible contribution may remain.
- `DEFENSIBLE NOVELTY` — no close work found that covers the core contribution after adversarial search and required full-text checks.

Add `PROVISIONAL` whenever unresolved close papers could change the verdict.

Also report novelty by dimension:

- conceptual
- methodological
- empirical
- data
- validation/evaluation

Do not collapse these into a single yes/no claim.

### 10. Reviewer #2 attack

Before recommending the topic, write the strongest rejection argument a skeptical reviewer could make:

- Which paper would they cite first?
- Which claimed contribution would they say is incremental?
- Which missing baseline or validation would weaken novelty?
- What experiment would most directly distinguish the new study from its nearest precedent?

Then state what must be changed or tested to survive that objection.

## Required final output

For a full novelty audit, return:

1. **Claim being audited** — one precise sentence.
2. **Search coverage** — date, sources/tools, query families, approximate candidate count.
3. **Closest competing papers** — ranked by threat, with access labels.
4. **Evidence matrix** — concise but sufficient to show substantive overlap.
5. **What is already known** — established parts that cannot be claimed as new.
6. **What may still be novel** — narrow, defensible contribution.
7. **Reviewer #2 attack** — strongest counterargument.
8. **Verdict** — one verdict plus `PROVISIONAL` if applicable.
9. **Confidence and unresolved evidence** — especially any abstract-only close competitors.
10. **Next experiment/search action** — only what would materially change the verdict.

## Hard stop conditions

Do not recommend a thesis title as locked, make a `first study` claim, or issue a high-confidence `GO` when any of the following is true:

- a top competitor remains unresolved and could invalidate the core contribution
- the comparison relies mostly on abstracts
- the supposed novelty is only year/region/sample-size recency
- the closest prior work differs only in dataset name or model brand
- publication status or bibliographic identity of a key competitor is uncertain

When these conditions occur, state exactly what evidence must be obtained next.
