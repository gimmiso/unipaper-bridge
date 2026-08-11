import { ConfigurationError, UpstreamError } from "./errors.js";
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

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  is_retracted?: boolean | null;
  best_oa_location?: OpenAlexLocation | null;
  primary_location?: OpenAlexLocation | null;
  open_access?: {
    is_oa?: boolean | null;
    oa_url?: string | null;
    any_repository_has_fulltext?: boolean | null;
  } | null;
}

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
        "User-Agent": "UniPaper-Bridge/0.1 (scholarly metadata lookup)",
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
  const apiKey = dependencies.openAlexApiKey?.trim();
  if (!apiKey) {
    throw new ConfigurationError(
      "Open-access lookup is not configured on this deployment. The operator must set OPENALEX_API_KEY.",
    );
  }

  const identifier = encodeURIComponent(`doi:${doi}`);
  const url = new URL(`https://api.openalex.org/works/${identifier}`);
  url.searchParams.set("api_key", apiKey);
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
