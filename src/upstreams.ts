import { UpstreamError } from "./errors.js";
import { normalizeDoi, resolveQueryType } from "./doi.js";

export type FetchLike = typeof fetch;

export interface ScholarlyDependencies {
  fetchImpl?: FetchLike;
  crossrefMailto?: string;
  openAlexApiKey?: string;
  timeoutMs?: number;
}

export interface PaperMatch {
  doi: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  publisher: string | null;
  type: string | null;
  canonical_url: string | null;
}

export interface ResolvePaperResult extends Record<string, unknown> {
  query_type: "doi" | "title";
  normalized_query: string;
  provider: "crossref";
  matches: PaperMatch[];
}

export interface OpenAccessResult extends Record<string, unknown> {
  doi: string;
  provider: "openalex";
  configured: boolean;
  found: boolean;
  is_open_access: boolean | null;
  title: string | null;
  year: number | null;
  is_retracted: boolean | null;
  landing_page_url: string | null;
  pdf_url: string | null;
  source_name: string | null;
  license: string | null;
  version: string | null;
  provider_record_url: string | null;
  note: string;
}

export type CitationRelation = "seed" | "referenced" | "citing" | "related";

export interface CitationNetworkPaper extends Record<string, unknown> {
  relation: CitationRelation;
  openalex_id: string;
  doi: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  type: string | null;
  cited_by_count: number;
  is_open_access: boolean | null;
  is_retracted: boolean | null;
  canonical_url: string;
  oa_url: string | null;
  relationship_note: string;
}

export interface CitationNetworkResult extends Record<string, unknown> {
  provider: "openalex";
  configured: true;
  seed: CitationNetworkPaper;
  requested_per_relation: number;
  counts: {
    references_reported: number;
    references_scanned: number;
    citing_works_reported: number;
    related_works_reported: number;
  };
  earlier_works: CitationNetworkPaper[];
  later_works: CitationNetworkPaper[];
  similar_works: CitationNetworkPaper[];
  citation_stance: "not_determined";
  notes: string[];
}

interface CrossrefDate {
  "date-parts"?: number[][];
}

interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string;
}

interface CrossrefWork {
  DOI?: string;
  title?: string[];
  author?: CrossrefAuthor[];
  published?: CrossrefDate;
  "published-print"?: CrossrefDate;
  "published-online"?: CrossrefDate;
  issued?: CrossrefDate;
  "container-title"?: string[];
  publisher?: string;
  type?: string;
  URL?: string;
}

interface CrossrefEnvelope {
  message: CrossrefWork | { items?: CrossrefWork[] };
}

interface OpenAlexLocation {
  landing_page_url?: string | null;
  pdf_url?: string | null;
  license?: string | null;
  version?: string | null;
  is_accepted?: boolean | null;
  is_published?: boolean | null;
  source?: { display_name?: string | null } | null;
}

interface OpenAlexAuthorship {
  author?: { display_name?: string | null } | null;
}

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  type?: string | null;
  cited_by_count?: number | null;
  is_retracted?: boolean | null;
  authorships?: OpenAlexAuthorship[] | null;
  referenced_works?: string[] | null;
  referenced_works_count?: number | null;
  related_works?: string[] | null;
  best_oa_location?: OpenAlexLocation | null;
  primary_location?: OpenAlexLocation | null;
  open_access?: {
    is_oa?: boolean | null;
    oa_url?: string | null;
    any_repository_has_fulltext?: boolean | null;
  } | null;
}

interface OpenAlexListEnvelope {
  meta?: { count?: number | null } | null;
  results?: OpenAlexWork[] | null;
}

const OPENALEX_NETWORK_FIELDS = [
  "id",
  "doi",
  "title",
  "publication_year",
  "type",
  "cited_by_count",
  "is_retracted",
  "authorships",
  "primary_location",
  "best_oa_location",
  "open_access",
].join(",");

const OPENALEX_REFERENCE_SCAN_LIMIT = 100;

function cleanText(value: string | undefined | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function extractYear(...dates: Array<CrossrefDate | undefined>): number | null {
  for (const date of dates) {
    const year = date?.["date-parts"]?.[0]?.[0];
    if (Number.isInteger(year) && year! > 0) return year!;
  }
  return null;
}

function mapCrossrefWork(work: CrossrefWork): PaperMatch {
  const title = cleanText(work.title?.[0]) ?? "Untitled work";
  const authors = (work.author ?? [])
    .map((author) => cleanText(author.name ?? [author.given, author.family].filter(Boolean).join(" ")))
    .filter((author): author is string => Boolean(author));

  let doi: string | null = null;
  if (work.DOI) {
    try {
      doi = normalizeDoi(work.DOI);
    } catch {
      doi = cleanText(work.DOI);
    }
  }

  return {
    doi,
    title,
    authors,
    year: extractYear(
      work["published-print"],
      work["published-online"],
      work.published,
      work.issued,
    ),
    venue: cleanText(work["container-title"]?.[0]),
    publisher: cleanText(work.publisher),
    type: cleanText(work.type),
    canonical_url: cleanText(work.URL) ?? (doi ? `https://doi.org/${doi}` : null),
  };
}

function openAlexApiKey(dependencies: ScholarlyDependencies): string | null {
  return dependencies.openAlexApiKey?.trim() || null;
}

function openAlexShortId(value: string | undefined | null): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const match = cleaned.match(/(?:^|\/)(W\d+)$/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function openAlexDoi(value: string | undefined | null): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  try {
    return normalizeDoi(cleaned);
  } catch {
    return null;
  }
}

function mapOpenAlexNetworkPaper(
  work: OpenAlexWork,
  relation: CitationRelation,
): CitationNetworkPaper | null {
  const openAlexId = openAlexShortId(work.id);
  if (!openAlexId) return null;
  const doi = openAlexDoi(work.doi);
  const title = cleanText(work.title) ?? "Untitled work";
  const authors = (work.authorships ?? [])
    .map((authorship) => cleanText(authorship.author?.display_name))
    .filter((author): author is string => Boolean(author));
  const canonicalUrl =
    (doi ? `https://doi.org/${doi}` : null) ??
    cleanText(work.primary_location?.landing_page_url) ??
    `https://openalex.org/${openAlexId}`;
  const relationshipNote =
    relation === "seed"
      ? "Seed paper used to expand the citation network."
      : relation === "referenced"
      ? "The seed paper cites this work."
      : relation === "citing"
        ? "This work cites the seed paper; inspect the citation context or full text before classifying it as supporting or contrasting."
        : "OpenAlex reports this as an algorithmically related work based on shared topics.";

  return {
    relation,
    openalex_id: openAlexId,
    doi,
    title,
    authors,
    year: Number.isInteger(work.publication_year) ? work.publication_year! : null,
    venue: cleanText(work.primary_location?.source?.display_name),
    type: cleanText(work.type),
    cited_by_count: Number.isInteger(work.cited_by_count)
      ? Math.max(0, work.cited_by_count!)
      : 0,
    is_open_access:
      typeof work.open_access?.is_oa === "boolean" ? work.open_access.is_oa : null,
    is_retracted: typeof work.is_retracted === "boolean" ? work.is_retracted : null,
    canonical_url: canonicalUrl,
    oa_url: work.open_access?.is_oa
      ? cleanText(work.best_oa_location?.landing_page_url) ??
        cleanText(work.open_access.oa_url)
      : null,
    relationship_note: relationshipNote,
  };
}

function rankByCitationCount(works: CitationNetworkPaper[]): CitationNetworkPaper[] {
  return [...works].sort(
    (left, right) =>
      right.cited_by_count - left.cited_by_count ||
      (right.year ?? -1) - (left.year ?? -1) ||
      left.title.localeCompare(right.title),
  );
}

async function fetchOpenAlexWorksByIds(
  ids: string[],
  relation: CitationRelation,
  apiKey: string | null,
  dependencies: ScholarlyDependencies,
): Promise<CitationNetworkPaper[]> {
  const uniqueIds = [...new Set(ids.map((id) => openAlexShortId(id)).filter(Boolean))] as string[];
  if (uniqueIds.length === 0) return [];

  const url = new URL("https://api.openalex.org/works");
  if (apiKey) url.searchParams.set("api_key", apiKey);
  url.searchParams.set("filter", `openalex_id:${uniqueIds.slice(0, 100).join("|")}`);
  url.searchParams.set("per_page", String(Math.min(uniqueIds.length, 100)));
  url.searchParams.set("select", OPENALEX_NETWORK_FIELDS);
  const payload = await fetchJson<OpenAlexListEnvelope>("OpenAlex", url, dependencies);
  return (payload.results ?? [])
    .map((work) => mapOpenAlexNetworkPaper(work, relation))
    .filter((work): work is CitationNetworkPaper => Boolean(work));
}

async function fetchJson<T>(
  service: string,
  url: URL,
  dependencies: ScholarlyDependencies,
): Promise<T> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 10_000);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "UniPaper-Bridge/0.2 (scholarly metadata lookup)",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new UpstreamError(service, `${service} did not respond before the timeout.`);
    }
    throw new UpstreamError(service, `${service} could not be reached.`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message =
      response.status === 404
        ? `${service} has no matching record.`
        : `${service} returned HTTP ${response.status}.`;
    throw new UpstreamError(service, message, response.status);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamError(service, `${service} returned an invalid JSON response.`);
  }
}

export async function resolvePaper(
  query: string,
  queryType: "auto" | "doi" | "title" = "auto",
  limit = 5,
  dependencies: ScholarlyDependencies = {},
): Promise<ResolvePaperResult> {
  const resolved = resolveQueryType(query, queryType);
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 10);
  let url: URL;

  if (resolved.type === "doi") {
    url = new URL(`https://api.crossref.org/works/${encodeURIComponent(resolved.value)}`);
  } else {
    url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query.title", resolved.value);
    url.searchParams.set("rows", String(boundedLimit));
  }

  if (dependencies.crossrefMailto) {
    url.searchParams.set("mailto", dependencies.crossrefMailto);
  }

  const payload = await fetchJson<CrossrefEnvelope>("Crossref", url, dependencies);
  const message = payload.message;
  const works =
    resolved.type === "doi"
      ? [message as CrossrefWork]
      : ((message as { items?: CrossrefWork[] }).items ?? []);

  return {
    query_type: resolved.type,
    normalized_query: resolved.value,
    provider: "crossref",
    matches: works.slice(0, boundedLimit).map(mapCrossrefWork),
  };
}

export async function findOpenAccess(
  doiInput: string,
  dependencies: ScholarlyDependencies = {},
): Promise<OpenAccessResult> {
  const doi = normalizeDoi(doiInput);
  const apiKey = openAlexApiKey(dependencies);

  const identifier = encodeURIComponent(`doi:${doi}`);
  const url = new URL(`https://api.openalex.org/works/${identifier}`);
  if (apiKey) url.searchParams.set("api_key", apiKey);
  url.searchParams.set(
    "select",
    "id,doi,title,publication_year,is_retracted,primary_location,best_oa_location,open_access",
  );

  try {
    const work = await fetchJson<OpenAlexWork>("OpenAlex", url, dependencies);
    const location = work.best_oa_location ?? null;
    const isOpen = Boolean(work.open_access?.is_oa);
    const landingPage =
      cleanText(location?.landing_page_url) ?? cleanText(work.open_access?.oa_url);
    const recordId = cleanText(work.id);

    return {
      doi,
      provider: "openalex",
      configured: true,
      found: true,
      is_open_access: isOpen,
      title: cleanText(work.title),
      year: Number.isInteger(work.publication_year) ? work.publication_year! : null,
      is_retracted: typeof work.is_retracted === "boolean" ? work.is_retracted : null,
      landing_page_url: isOpen ? landingPage : null,
      pdf_url: isOpen ? cleanText(location?.pdf_url) : null,
      source_name: isOpen ? cleanText(location?.source?.display_name) : null,
      license: isOpen ? cleanText(location?.license) : null,
      version: isOpen ? cleanText(location?.version) : null,
      provider_record_url: recordId,
      note: isOpen
        ? "OpenAlex reports an open-access location. Verify the licence and article version on the landing page."
        : "OpenAlex does not currently report an open-access full-text location for this DOI.",
    };
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) {
      return {
        doi,
        provider: "openalex",
        configured: true,
        found: false,
        is_open_access: null,
        title: null,
        year: null,
        is_retracted: null,
        landing_page_url: null,
        pdf_url: null,
        source_name: null,
        license: null,
        version: null,
        provider_record_url: null,
        note: "OpenAlex has no record for this DOI.",
      };
    }
    throw error;
  }
}

export async function expandCitationNetwork(
  doiInput: string,
  perRelation = 5,
  dependencies: ScholarlyDependencies = {},
): Promise<CitationNetworkResult> {
  const doi = normalizeDoi(doiInput);
  const apiKey = openAlexApiKey(dependencies);
  const boundedLimit = Math.min(Math.max(Math.trunc(perRelation), 1), 10);
  const identifier = encodeURIComponent(`doi:${doi}`);
  const seedUrl = new URL(`https://api.openalex.org/works/${identifier}`);
  if (apiKey) seedUrl.searchParams.set("api_key", apiKey);
  seedUrl.searchParams.set(
    "select",
    `${OPENALEX_NETWORK_FIELDS},referenced_works,referenced_works_count,related_works`,
  );

  const seedWork = await fetchJson<OpenAlexWork>("OpenAlex", seedUrl, dependencies);
  const seed = mapOpenAlexNetworkPaper(seedWork, "seed");
  if (!seed) {
    throw new UpstreamError("OpenAlex", "OpenAlex returned a work without a valid work ID.");
  }
  const referencedIds = (seedWork.referenced_works ?? []).slice(
    0,
    OPENALEX_REFERENCE_SCAN_LIMIT,
  );
  const relatedIds = (seedWork.related_works ?? []).slice(0, 10);
  const earlierPool = await fetchOpenAlexWorksByIds(
    referencedIds,
    "referenced",
    apiKey,
    dependencies,
  );

  const laterUrl = new URL("https://api.openalex.org/works");
  if (apiKey) laterUrl.searchParams.set("api_key", apiKey);
  laterUrl.searchParams.set("filter", `cites:${seed.openalex_id}`);
  laterUrl.searchParams.set("sort", "cited_by_count:desc");
  laterUrl.searchParams.set("per_page", String(boundedLimit));
  laterUrl.searchParams.set("select", OPENALEX_NETWORK_FIELDS);
  const laterPayload = await fetchJson<OpenAlexListEnvelope>(
    "OpenAlex",
    laterUrl,
    dependencies,
  );
  const laterPool = (laterPayload.results ?? [])
    .map((work) => mapOpenAlexNetworkPaper(work, "citing"))
    .filter((work): work is CitationNetworkPaper => Boolean(work));

  const similarPool = await fetchOpenAlexWorksByIds(
    relatedIds,
    "related",
    apiKey,
    dependencies,
  );
  const similarById = new Map(similarPool.map((work) => [work.openalex_id, work]));
  const orderedSimilar = relatedIds
    .map((id) => openAlexShortId(id))
    .map((id) => (id ? similarById.get(id) : undefined))
    .filter((work): work is CitationNetworkPaper => Boolean(work));

  const seen = new Set<string>([
    `openalex:${seed.openalex_id}`,
    ...(seed.doi ? [`doi:${seed.doi}`] : []),
  ]);
  const deduplicate = (works: CitationNetworkPaper[]) =>
    works.filter((work) => {
      const key = work.doi ? `doi:${work.doi}` : `openalex:${work.openalex_id}`;
      const alternateKey = `openalex:${work.openalex_id}`;
      if (seen.has(key) || seen.has(alternateKey)) return false;
      seen.add(key);
      seen.add(alternateKey);
      return true;
    });

  const earlierWorks = deduplicate(rankByCitationCount(earlierPool)).slice(
    0,
    boundedLimit,
  );
  const laterWorks = deduplicate(laterPool).slice(0, boundedLimit);
  const similarWorks = deduplicate(orderedSimilar).slice(0, boundedLimit);
  const referencesReported = Number.isInteger(seedWork.referenced_works_count)
    ? Math.max(0, seedWork.referenced_works_count!)
    : seedWork.referenced_works?.length ?? 0;

  return {
    provider: "openalex",
    configured: true,
    seed,
    requested_per_relation: boundedLimit,
    counts: {
      references_reported: referencesReported,
      references_scanned: referencedIds.length,
      citing_works_reported: Number.isInteger(laterPayload.meta?.count)
        ? Math.max(0, laterPayload.meta!.count!)
        : laterPool.length,
      related_works_reported: seedWork.related_works?.length ?? 0,
    },
    earlier_works: earlierWorks,
    later_works: laterWorks,
    similar_works: similarWorks,
    citation_stance: "not_determined",
    notes: [
      "Earlier works are direct references ranked by citation count within the scanned reference pool.",
      "Later works directly cite the seed and are ranked by citation count.",
      "Similar works come from OpenAlex topic similarity and are not necessarily direct citations.",
      "Citation links do not reveal whether a later paper supports, disputes, or merely mentions the seed; inspect citation context or full text before making that claim.",
      referencesReported > referencedIds.length
        ? `The seed reports ${referencesReported} references; this bounded request scanned the first ${referencedIds.length}.`
        : `Scanned all ${referencedIds.length} OpenAlex-matched references reported for the seed.`,
    ],
  };
}
