const SERVER_NAME = "unipaper-bridge";
const SERVER_VERSION = "0.2.0";
const MCP_PATH = "/api/mcp";
const LATEST_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]);
const MAX_BODY_BYTES = 1_000_000;

const SERVER_INSTRUCTIONS =
  "Resolve the exact paper first. Expand the citation network when broader literature coverage matters, but never infer support or contradiction from a citation link alone. Then check lawful open access. If no OA copy exists, build an institution link only for an adapter the user selects. The user must authenticate in their own browser. Never request credentials, cookies, MFA codes, proxy sessions, or bulk downloads. Never claim full-text access until the user supplies or opens the full article.";

const INSTITUTIONS = [
  {
    id: "khu-seoul",
    institution: "Kyung Hee University",
    campus: "Seoul Campus",
    country: "KR",
    proxyPrefix: "https://openlink.khu.ac.kr/link.n2s?url=",
    accessGuideUrl: "https://lib.khu.ac.kr/webcontent/info/1",
    fairUsePolicyUrl: "https://lib.khu.ac.kr/webcontent/info/2",
    usageNote:
      "Sign in to KHU Library in your own browser. Use licensed material only for personal research; do not automate or redistribute downloads.",
    workingDownloadCeilingPerPublisherPerDay: 20,
  },
  {
    id: "khu-global",
    institution: "Kyung Hee University",
    campus: "Global Campus",
    country: "KR",
    proxyPrefix: "https://webgate.khu.ac.kr/link.n2s?url=",
    accessGuideUrl: "https://lib.khu.ac.kr/webcontent/info/1",
    fairUsePolicyUrl: "https://lib.khu.ac.kr/webcontent/info/2",
    usageNote:
      "Sign in to KHU Library in your own browser. Use licensed material only for personal research; do not automate or redistribute downloads.",
    workingDownloadCeilingPerPublisherPerDay: 20,
  },
];

const paperMatchSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "doi",
    "title",
    "authors",
    "year",
    "venue",
    "publisher",
    "type",
    "canonical_url",
  ],
  properties: {
    doi: { type: ["string", "null"] },
    title: { type: "string" },
    authors: { type: "array", items: { type: "string" } },
    year: { type: ["integer", "null"] },
    venue: { type: ["string", "null"] },
    publisher: { type: ["string", "null"] },
    type: { type: ["string", "null"] },
    canonical_url: { type: ["string", "null"] },
  },
};

const citationNetworkPaperSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "relation",
    "openalex_id",
    "doi",
    "title",
    "authors",
    "year",
    "venue",
    "type",
    "cited_by_count",
    "is_open_access",
    "is_retracted",
    "canonical_url",
    "oa_url",
    "relationship_note",
  ],
  properties: {
    relation: { enum: ["seed", "referenced", "citing", "related"] },
    openalex_id: { type: "string" },
    doi: { type: ["string", "null"] },
    title: { type: "string" },
    authors: { type: "array", items: { type: "string" } },
    year: { type: ["integer", "null"] },
    venue: { type: ["string", "null"] },
    type: { type: ["string", "null"] },
    cited_by_count: { type: "integer" },
    is_open_access: { type: ["boolean", "null"] },
    is_retracted: { type: ["boolean", "null"] },
    canonical_url: { type: "string" },
    oa_url: { type: ["string", "null"] },
    relationship_note: { type: "string" },
  },
};

const institutionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "institution",
    "campus",
    "country",
    "access_guide_url",
    "fair_use_policy_url",
    "access_url_pattern",
    "authentication",
    "credentials_handled_by_server",
    "usage_note",
    "working_download_ceiling_per_publisher_per_day",
  ],
  properties: {
    id: { type: "string" },
    institution: { type: "string" },
    campus: { type: "string" },
    country: { type: "string" },
    access_guide_url: { type: "string" },
    fair_use_policy_url: { type: "string" },
    access_url_pattern: { type: "string" },
    authentication: { const: "user_browser" },
    credentials_handled_by_server: { const: false },
    usage_note: { type: "string" },
    working_download_ceiling_per_publisher_per_day: { type: "integer" },
  },
};

const TOOLS = [
  {
    name: "resolve_paper",
    title: "Resolve paper metadata",
    description:
      "Use this to identify a scholarly work by DOI or title before looking for full text or constructing a library link.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 512,
          description: "A DOI, DOI URL, or paper title.",
        },
        query_type: {
          type: "string",
          enum: ["auto", "doi", "title"],
          default: "auto",
          description: "Use auto unless the input type is known.",
        },
        limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query_type", "normalized_query", "provider", "matches"],
      properties: {
        query_type: { type: "string", enum: ["doi", "title"] },
        normalized_query: { type: "string" },
        provider: { const: "crossref" },
        matches: { type: "array", items: paperMatchSchema },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "expand_citation_network",
    title: "Expand a paper's citation network",
    description:
      "Use this after resolving a DOI to find bounded sets of influential references, later papers that cite the seed, and topic-similar works. Results are deduplicated. A citation link never proves support or contradiction; inspect citation context or full text before classifying stance.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["doi"],
      properties: {
        doi: {
          type: "string",
          minLength: 1,
          maxLength: 512,
          description: "The resolved DOI or DOI URL.",
        },
        per_relation: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          default: 5,
          description: "Maximum results for each of earlier, later, and similar works.",
        },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "provider",
        "configured",
        "seed",
        "requested_per_relation",
        "counts",
        "earlier_works",
        "later_works",
        "similar_works",
        "citation_stance",
        "notes",
      ],
      properties: {
        provider: { const: "openalex" },
        configured: { const: true },
        seed: citationNetworkPaperSchema,
        requested_per_relation: { type: "integer" },
        counts: {
          type: "object",
          additionalProperties: false,
          required: [
            "references_reported",
            "references_scanned",
            "citing_works_reported",
            "related_works_reported",
          ],
          properties: {
            references_reported: { type: "integer" },
            references_scanned: { type: "integer" },
            citing_works_reported: { type: "integer" },
            related_works_reported: { type: "integer" },
          },
        },
        earlier_works: { type: "array", items: citationNetworkPaperSchema },
        later_works: { type: "array", items: citationNetworkPaperSchema },
        similar_works: { type: "array", items: citationNetworkPaperSchema },
        citation_stance: { const: "not_determined" },
        notes: { type: "array", items: { type: "string" } },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "find_open_access",
    title: "Find lawful open access",
    description:
      "Use this after resolving a DOI to check whether OpenAlex reports a lawful open-access landing page or PDF.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["doi"],
      properties: {
        doi: {
          type: "string",
          minLength: 1,
          maxLength: 512,
          description: "The resolved DOI or DOI URL.",
        },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "doi",
        "provider",
        "configured",
        "found",
        "is_open_access",
        "title",
        "year",
        "is_retracted",
        "landing_page_url",
        "pdf_url",
        "source_name",
        "license",
        "version",
        "provider_record_url",
        "note",
      ],
      properties: {
        doi: { type: "string" },
        provider: { const: "openalex" },
        configured: { type: "boolean" },
        found: { type: "boolean" },
        is_open_access: { type: ["boolean", "null"] },
        title: { type: ["string", "null"] },
        year: { type: ["integer", "null"] },
        is_retracted: { type: ["boolean", "null"] },
        landing_page_url: { type: ["string", "null"] },
        pdf_url: { type: ["string", "null"] },
        source_name: { type: ["string", "null"] },
        license: { type: ["string", "null"] },
        version: { type: ["string", "null"] },
        provider_record_url: { type: ["string", "null"] },
        note: { type: "string" },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "list_institutions",
    title: "List institution adapters",
    description:
      "Use this to see which university library link adapters are supported and to obtain their current access and fair-use guidance.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["institutions"],
      properties: {
        institutions: { type: "array", items: institutionSchema },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "build_institution_link",
    title: "Build institutional access link",
    description:
      "Use this only after the user selects a supported institution and the exact public publisher or repository URL is known. It constructs a link but never opens it or handles authentication.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["institution_id", "target_url"],
      properties: {
        institution_id: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description:
            "An ID returned by list_institutions, such as khu-seoul.",
        },
        target_url: {
          type: "string",
          minLength: 1,
          maxLength: 4096,
          description: "The canonical public publisher or repository URL.",
        },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "institution_id",
        "institution",
        "campus",
        "target_url",
        "access_url",
        "authentication",
        "credentials_handled_by_server",
        "access_guide_url",
        "fair_use_policy_url",
        "usage_note",
        "next_steps",
      ],
      properties: {
        institution_id: { type: "string" },
        institution: { type: "string" },
        campus: { type: "string" },
        target_url: { type: "string" },
        access_url: { type: "string" },
        authentication: { const: "user_browser" },
        credentials_handled_by_server: { const: false },
        access_guide_url: { type: "string" },
        fair_use_policy_url: { type: "string" },
        usage_note: { type: "string" },
        next_steps: { type: "array", items: { type: "string" } },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
];

class PublicError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PublicError";
    this.status = status;
  }
}

function cleanText(value) {
  if (typeof value !== "string" || !value) return null;
  const cleaned = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicError("Tool arguments must be a JSON object.");
  }
  return value;
}

function requireString(value, label, min, max) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new PublicError(`${label} must be between ${min} and ${max} characters.`);
  }
  return value;
}

function normalizeDoi(input) {
  let value = requireString(input, "DOI", 1, 512).trim();
  value = value.replace(/^doi:\s*/i, "");

  try {
    const candidate = new URL(value);
    const hostname = candidate.hostname.toLowerCase();
    if (hostname === "doi.org" || hostname === "dx.doi.org") {
      value = candidate.pathname.replace(/^\//, "");
    }
  } catch {
    value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  }

  try {
    value = decodeURIComponent(value);
  } catch {
    throw new PublicError("DOI contains invalid percent encoding.");
  }

  if (!/^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i.test(value)) {
    throw new PublicError(
      "That does not look like a DOI. Use a value such as 10.1038/s41586-024-00000-0.",
    );
  }
  return value.toLowerCase();
}

function normalizeTitle(input) {
  const value = requireString(input, "Paper title", 1, 512)
    .replace(/\s+/g, " ")
    .trim();
  if (value.length < 3 || value.length > 500) {
    throw new PublicError("Paper title must be between 3 and 500 characters.");
  }
  if (/\p{Cc}/u.test(value)) {
    throw new PublicError("Paper title contains unsupported control characters.");
  }
  return value;
}

function resolveQueryType(query, requested) {
  if (requested === "doi") return { type: "doi", value: normalizeDoi(query) };
  if (requested === "title") return { type: "title", value: normalizeTitle(query) };
  try {
    return { type: "doi", value: normalizeDoi(query) };
  } catch {
    return { type: "title", value: normalizeTitle(query) };
  }
}

function extractYear(...dates) {
  for (const date of dates) {
    const year = date?.["date-parts"]?.[0]?.[0];
    if (Number.isInteger(year) && year > 0) return year;
  }
  return null;
}

function mapCrossrefWork(work) {
  const title = cleanText(work?.title?.[0]) ?? "Untitled work";
  const authors = (Array.isArray(work?.author) ? work.author : [])
    .map((author) =>
      cleanText(
        author?.name ?? [author?.given, author?.family].filter(Boolean).join(" "),
      ),
    )
    .filter(Boolean);

  let doi = null;
  if (work?.DOI) {
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
      work?.["published-print"],
      work?.["published-online"],
      work?.published,
      work?.issued,
    ),
    venue: cleanText(work?.["container-title"]?.[0]),
    publisher: cleanText(work?.publisher),
    type: cleanText(work?.type),
    canonical_url: cleanText(work?.URL) ?? (doi ? `https://doi.org/${doi}` : null),
  };
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

function openAlexApiKey(env) {
  const apiKey =
    typeof env?.OPENALEX_API_KEY === "string" ? env.OPENALEX_API_KEY.trim() : "";
  return apiKey || null;
}

function openAlexShortId(value) {
  const cleaned = cleanText(value);
  const match = cleaned?.match(/(?:^|\/)(W\d+)$/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function openAlexDoi(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  try {
    return normalizeDoi(cleaned);
  } catch {
    return null;
  }
}

function mapOpenAlexNetworkPaper(work, relation) {
  const openAlexId = openAlexShortId(work?.id);
  if (!openAlexId) return null;
  const doi = openAlexDoi(work?.doi);
  const authors = (Array.isArray(work?.authorships) ? work.authorships : [])
    .map((authorship) => cleanText(authorship?.author?.display_name))
    .filter(Boolean);
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
    title: cleanText(work?.title) ?? "Untitled work",
    authors,
    year: Number.isInteger(work?.publication_year) ? work.publication_year : null,
    venue: cleanText(work?.primary_location?.source?.display_name),
    type: cleanText(work?.type),
    cited_by_count: Number.isInteger(work?.cited_by_count)
      ? Math.max(0, work.cited_by_count)
      : 0,
    is_open_access:
      typeof work?.open_access?.is_oa === "boolean" ? work.open_access.is_oa : null,
    is_retracted:
      typeof work?.is_retracted === "boolean" ? work.is_retracted : null,
    canonical_url:
      (doi ? `https://doi.org/${doi}` : null) ??
      cleanText(work?.primary_location?.landing_page_url) ??
      `https://openalex.org/${openAlexId}`,
    oa_url: work?.open_access?.is_oa
      ? cleanText(work?.best_oa_location?.landing_page_url) ??
        cleanText(work?.open_access?.oa_url)
      : null,
    relationship_note: relationshipNote,
  };
}

function rankByCitationCount(works) {
  return [...works].sort(
    (left, right) =>
      right.cited_by_count - left.cited_by_count ||
      (right.year ?? -1) - (left.year ?? -1) ||
      left.title.localeCompare(right.title),
  );
}

async function fetchJson(service, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new PublicError(`${service} did not respond before the timeout.`);
    }
    throw new PublicError(`${service} could not be reached.`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const message =
      response.status === 404
        ? `${service} has no matching record.`
        : `${service} returned HTTP ${response.status}.`;
    throw new PublicError(message, response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new PublicError(`${service} returned an invalid JSON response.`);
  }
}

async function fetchOpenAlexWorksByIds(ids, relation, apiKey) {
  const uniqueIds = [
    ...new Set(ids.map((id) => openAlexShortId(id)).filter(Boolean)),
  ];
  if (uniqueIds.length === 0) return [];
  const url = new URL("https://api.openalex.org/works");
  if (apiKey) url.searchParams.set("api_key", apiKey);
  url.searchParams.set("filter", `openalex_id:${uniqueIds.slice(0, 100).join("|")}`);
  url.searchParams.set("per_page", String(Math.min(uniqueIds.length, 100)));
  url.searchParams.set("select", OPENALEX_NETWORK_FIELDS);
  const payload = await fetchJson("OpenAlex", url);
  return (Array.isArray(payload?.results) ? payload.results : [])
    .map((work) => mapOpenAlexNetworkPaper(work, relation))
    .filter(Boolean);
}

async function resolvePaper(args, env) {
  const input = requireObject(args);
  const query = requireString(input.query, "Query", 1, 512);
  const queryType = input.query_type ?? "auto";
  if (!["auto", "doi", "title"].includes(queryType)) {
    throw new PublicError("query_type must be auto, doi, or title.");
  }
  const limit = input.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new PublicError("limit must be an integer between 1 and 10.");
  }

  const resolved = resolveQueryType(query, queryType);
  let url;
  if (resolved.type === "doi") {
    url = new URL(`https://api.crossref.org/works/${encodeURIComponent(resolved.value)}`);
  } else {
    url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query.title", resolved.value);
    url.searchParams.set("rows", String(limit));
  }
  const crossrefMailto =
    typeof env?.CROSSREF_MAILTO === "string" ? env.CROSSREF_MAILTO.trim() : "";
  if (crossrefMailto) url.searchParams.set("mailto", crossrefMailto);

  const payload = await fetchJson("Crossref", url);
  const message = payload?.message;
  const works =
    resolved.type === "doi"
      ? [message]
      : Array.isArray(message?.items)
        ? message.items
        : [];
  const result = {
    query_type: resolved.type,
    normalized_query: resolved.value,
    provider: "crossref",
    matches: works.slice(0, limit).map(mapCrossrefWork),
  };
  return toolSuccess(
    result,
    `Crossref returned ${result.matches.length} metadata match${result.matches.length === 1 ? "" : "es"}.`,
  );
}

async function expandCitationNetwork(args, env) {
  const input = requireObject(args);
  const doi = normalizeDoi(input.doi);
  const perRelation = input.per_relation ?? 5;
  if (!Number.isInteger(perRelation) || perRelation < 1 || perRelation > 10) {
    throw new PublicError("per_relation must be an integer between 1 and 10.");
  }
  const apiKey = openAlexApiKey(env);
  const identifier = encodeURIComponent(`doi:${doi}`);
  const seedUrl = new URL(`https://api.openalex.org/works/${identifier}`);
  if (apiKey) seedUrl.searchParams.set("api_key", apiKey);
  seedUrl.searchParams.set(
    "select",
    `${OPENALEX_NETWORK_FIELDS},referenced_works,referenced_works_count,related_works`,
  );
  const seedWork = await fetchJson("OpenAlex", seedUrl);
  const seed = mapOpenAlexNetworkPaper(seedWork, "seed");
  if (!seed) {
    throw new PublicError("OpenAlex returned a work without a valid work ID.");
  }

  const referencedIds = (Array.isArray(seedWork?.referenced_works)
    ? seedWork.referenced_works
    : []
  ).slice(0, OPENALEX_REFERENCE_SCAN_LIMIT);
  const relatedIds = (Array.isArray(seedWork?.related_works)
    ? seedWork.related_works
    : []
  ).slice(0, 10);
  const earlierPool = await fetchOpenAlexWorksByIds(
    referencedIds,
    "referenced",
    apiKey,
  );

  const laterUrl = new URL("https://api.openalex.org/works");
  if (apiKey) laterUrl.searchParams.set("api_key", apiKey);
  laterUrl.searchParams.set("filter", `cites:${seed.openalex_id}`);
  laterUrl.searchParams.set("sort", "cited_by_count:desc");
  laterUrl.searchParams.set("per_page", String(perRelation));
  laterUrl.searchParams.set("select", OPENALEX_NETWORK_FIELDS);
  const laterPayload = await fetchJson("OpenAlex", laterUrl);
  const laterPool = (Array.isArray(laterPayload?.results)
    ? laterPayload.results
    : []
  )
    .map((work) => mapOpenAlexNetworkPaper(work, "citing"))
    .filter(Boolean);

  const similarPool = await fetchOpenAlexWorksByIds(
    relatedIds,
    "related",
    apiKey,
  );
  const similarById = new Map(similarPool.map((work) => [work.openalex_id, work]));
  const orderedSimilar = relatedIds
    .map((id) => openAlexShortId(id))
    .map((id) => (id ? similarById.get(id) : undefined))
    .filter(Boolean);
  const seen = new Set([
    `openalex:${seed.openalex_id}`,
    ...(seed.doi ? [`doi:${seed.doi}`] : []),
  ]);
  const deduplicate = (works) =>
    works.filter((work) => {
      const key = work.doi ? `doi:${work.doi}` : `openalex:${work.openalex_id}`;
      const alternateKey = `openalex:${work.openalex_id}`;
      if (seen.has(key) || seen.has(alternateKey)) return false;
      seen.add(key);
      seen.add(alternateKey);
      return true;
    });

  const referencesReported = Number.isInteger(seedWork?.referenced_works_count)
    ? Math.max(0, seedWork.referenced_works_count)
    : referencedIds.length;
  const result = {
    provider: "openalex",
    configured: true,
    seed,
    requested_per_relation: perRelation,
    counts: {
      references_reported: referencesReported,
      references_scanned: referencedIds.length,
      citing_works_reported: Number.isInteger(laterPayload?.meta?.count)
        ? Math.max(0, laterPayload.meta.count)
        : laterPool.length,
      related_works_reported: Array.isArray(seedWork?.related_works)
        ? seedWork.related_works.length
        : 0,
    },
    earlier_works: deduplicate(rankByCitationCount(earlierPool)).slice(
      0,
      perRelation,
    ),
    later_works: deduplicate(laterPool).slice(0, perRelation),
    similar_works: deduplicate(orderedSimilar).slice(0, perRelation),
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
  const returned =
    result.earlier_works.length +
    result.later_works.length +
    result.similar_works.length;
  return toolSuccess(
    result,
    `OpenAlex returned ${returned} deduplicated citation-network candidates. Citation stance remains undetermined until context or full text is inspected.`,
  );
}

function emptyOpenAlexResult(doi, note) {
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
    note,
  };
}

async function findOpenAccess(args, env) {
  const input = requireObject(args);
  const doi = normalizeDoi(input.doi);
  const apiKey = openAlexApiKey(env);

  const identifier = encodeURIComponent(`doi:${doi}`);
  const url = new URL(`https://api.openalex.org/works/${identifier}`);
  if (apiKey) url.searchParams.set("api_key", apiKey);
  url.searchParams.set(
    "select",
    "id,doi,title,publication_year,is_retracted,primary_location,best_oa_location,open_access",
  );

  let work;
  try {
    work = await fetchJson("OpenAlex", url);
  } catch (error) {
    if (error instanceof PublicError && error.status === 404) {
      const result = emptyOpenAlexResult(doi, "OpenAlex has no record for this DOI.");
      return toolSuccess(result, result.note);
    }
    throw error;
  }

  const location = work?.best_oa_location ?? null;
  const isOpen = Boolean(work?.open_access?.is_oa);
  const landingPage =
    cleanText(location?.landing_page_url) ?? cleanText(work?.open_access?.oa_url);
  const result = {
    doi,
    provider: "openalex",
    configured: true,
    found: true,
    is_open_access: isOpen,
    title: cleanText(work?.title),
    year: Number.isInteger(work?.publication_year) ? work.publication_year : null,
    is_retracted:
      typeof work?.is_retracted === "boolean" ? work.is_retracted : null,
    landing_page_url: isOpen ? landingPage : null,
    pdf_url: isOpen ? cleanText(location?.pdf_url) : null,
    source_name: isOpen ? cleanText(location?.source?.display_name) : null,
    license: isOpen ? cleanText(location?.license) : null,
    version: isOpen ? cleanText(location?.version) : null,
    provider_record_url: cleanText(work?.id),
    note: isOpen
      ? "OpenAlex reports an open-access location. Verify the licence and article version on the landing page."
      : "OpenAlex does not currently report an open-access full-text location for this DOI.",
  };
  return toolSuccess(result, result.note);
}

function publicInstitution(adapter) {
  return {
    id: adapter.id,
    institution: adapter.institution,
    campus: adapter.campus,
    country: adapter.country,
    access_guide_url: adapter.accessGuideUrl,
    fair_use_policy_url: adapter.fairUsePolicyUrl,
    access_url_pattern: `${adapter.proxyPrefix}{target_url}`,
    authentication: "user_browser",
    credentials_handled_by_server: false,
    usage_note: adapter.usageNote,
    working_download_ceiling_per_publisher_per_day:
      adapter.workingDownloadCeilingPerPublisherPerDay,
  };
}

function listInstitutions(args) {
  const input = args ?? {};
  requireObject(input);
  if (Object.keys(input).length > 0) {
    throw new PublicError("list_institutions does not accept arguments.");
  }
  const institutions = INSTITUTIONS.map(publicInstitution);
  return toolSuccess(
    { institutions },
    `Found ${institutions.length} institution adapters. Authentication always stays in the user's browser.`,
  );
}

function validatePublicTargetUrl(input) {
  requireString(input, "Target URL", 1, 4096);
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new PublicError("Target URL must be an absolute HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new PublicError("Only HTTP and HTTPS target URLs are supported.");
  }
  if (url.username || url.password) {
    throw new PublicError("Target URLs must not contain usernames or passwords.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blockedHosts = new Set([
    "localhost",
    "openlink.khu.ac.kr",
    "webgate.khu.ac.kr",
  ]);
  const blockedSuffixes = [".localhost", ".local", ".internal", ".invalid", ".test"];
  const literalIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
  const literalIpv6 = hostname.includes(":");
  if (
    !hostname ||
    blockedHosts.has(hostname) ||
    blockedSuffixes.some((suffix) => hostname.endsWith(suffix)) ||
    literalIpv4 ||
    literalIpv6
  ) {
    throw new PublicError("Target URL must use a public publisher or repository host.");
  }
  return url;
}

function buildInstitutionLink(args) {
  const input = requireObject(args);
  const institutionId = requireString(input.institution_id, "institution_id", 1, 100);
  const targetInput = requireString(input.target_url, "target_url", 1, 4096);
  const adapter = INSTITUTIONS.find((item) => item.id === institutionId);
  if (!adapter) {
    throw new PublicError(
      `Unknown institution adapter '${institutionId}'. Call list_institutions first.`,
    );
  }
  const target = validatePublicTargetUrl(targetInput).toString();
  const result = {
    institution_id: adapter.id,
    institution: adapter.institution,
    campus: adapter.campus,
    target_url: target,
    access_url: `${adapter.proxyPrefix}${target}`,
    authentication: "user_browser",
    credentials_handled_by_server: false,
    access_guide_url: adapter.accessGuideUrl,
    fair_use_policy_url: adapter.fairUsePolicyUrl,
    usage_note: adapter.usageNote,
    next_steps: [
      "Open the access URL in your own browser.",
      "Sign in directly on the institution's site if prompted; never send credentials to the MCP server or model.",
      "Confirm the article title and DOI, then download only the individually selected paper if your licence permits it.",
      "Attach the lawfully obtained PDF to the conversation for full-text analysis.",
    ],
  };
  return toolSuccess(
    result,
    "Institutional link built. The user must open it and sign in directly in their own browser.",
  );
}

function toolSuccess(structuredContent, text) {
  return {
    structuredContent,
    content: [{ type: "text", text }],
  };
}

function toolError(error) {
  const message =
    error instanceof PublicError
      ? error.message
      : "The request could not be completed. Check the input and try again.";
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

async function callTool(name, args, env) {
  try {
    switch (name) {
      case "resolve_paper":
        return await resolvePaper(args, env);
      case "expand_citation_network":
        return await expandCitationNetwork(args, env);
      case "find_open_access":
        return await findOpenAccess(args, env);
      case "list_institutions":
        return listInstitutions(args);
      case "build_institution_link":
        return buildInstitutionLink(args);
      default:
        throw new PublicError(`Unknown tool '${String(name)}'.`);
    }
  } catch (error) {
    if (!(error instanceof PublicError)) {
      console.error("MCP tool failed", { tool: String(name) });
    }
    return toolError(error);
  }
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRpc(message, env) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return rpcError(null, -32600, "Invalid Request");
  }
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const id = hasId ? message.id : null;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(id, -32600, "Invalid Request");
  }

  if (message.method.startsWith("notifications/")) return null;

  switch (message.method) {
    case "initialize": {
      const requested = message.params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: SERVER_NAME,
          title: "UniPaper Bridge",
          version: SERVER_VERSION,
        },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = message.params?.name;
      if (typeof name !== "string") {
        return rpcError(id, -32602, "Tool name is required.");
      }
      const result = await callTool(name, message.params?.arguments ?? {}, env);
      return rpcResult(id, result);
    }
    default:
      return rpcError(id, -32601, "Method not found");
  }
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, mcp-protocol-version, mcp-session-id, authorization",
  "access-control-expose-headers": "mcp-protocol-version",
};

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

async function handleMcp(request, env) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse(rpcError(null, -32600, "Request body is too large."), 413);
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error"), 400);
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return jsonResponse(rpcError(null, -32600, "Request body is too large."), 413);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error"), 400);
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return jsonResponse(rpcError(null, -32600, "Invalid Request"), 400);
    }
    const results = (await Promise.all(payload.map((item) => handleRpc(item, env)))).filter(
      Boolean,
    );
    if (results.length === 0) return new Response(null, { status: 202, headers: corsHeaders });
    return jsonResponse(results);
  }

  const result = await handleRpc(payload, env);
  if (result === null) return new Response(null, { status: 202, headers: corsHeaders });
  return jsonResponse(result, result.error ? 400 : 200, {
    "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
  });
}

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>UniPaper Bridge MCP</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #15362f; background: #f3f7f5; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; }
      main { width: min(680px, 100%); background: white; border: 1px solid #dbe8e3; border-radius: 24px; padding: clamp(28px, 6vw, 52px); box-shadow: 0 20px 55px rgba(28, 70, 58, .09); }
      .status { display: inline-flex; align-items: center; gap: 8px; color: #176b4d; font-size: 14px; font-weight: 700; }
      .dot { width: 9px; height: 9px; border-radius: 50%; background: #27ae75; box-shadow: 0 0 0 5px #e3f6ee; }
      h1 { margin: 22px 0 12px; font-size: clamp(34px, 7vw, 58px); letter-spacing: -.055em; line-height: .98; }
      p { color: #526861; line-height: 1.65; }
      code { padding: 3px 7px; border-radius: 7px; background: #edf4f1; color: #164b3c; }
      ul { margin: 26px 0; padding-left: 20px; color: #38574e; line-height: 1.9; }
      nav { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
      a { color: #12664a; font-weight: 700; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <main>
      <div class="status"><span class="dot"></span>Service online</div>
      <h1>UniPaper<br>Bridge</h1>
      <p>A privacy-preserving MCP bridge for scholarly metadata, bounded citation-network discovery, and user-controlled institutional library access.</p>
      <ul>
        <li>Public MCP endpoint: <code>/api/mcp</code></li>
        <li>Health check: <code>/healthz</code></li>
        <li>One-hop earlier, later, and similar-paper expansion</li>
        <li>University authentication stays in the user's browser</li>
        <li>No passwords, MFA codes, cookies, sessions, or PDFs are stored</li>
      </ul>
      <nav>
        <a href="https://github.com/gimmiso/unipaper-bridge">Source code</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </nav>
    </main>
  </body>
</html>`;

const privacyPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy — UniPaper Bridge</title></head><body style="font:16px/1.65 system-ui;max-width:760px;margin:48px auto;padding:0 24px;color:#183a31"><h1>Privacy</h1><p>UniPaper Bridge processes paper identifiers, titles, and public publisher URLs only to return scholarly metadata, bounded citation-network candidates, and user-openable links. It does not request or store university passwords, MFA codes, browser cookies, proxy sessions, or article PDFs.</p><p>University authentication occurs directly between the user and their institution in the user's browser. Requests may be sent to Crossref and, when configured, OpenAlex under those providers' policies. Operational logs are limited to service errors and do not intentionally record credentials or API keys.</p><p><a href="/">Back</a></p></body></html>`;

const termsPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terms — UniPaper Bridge</title></head><body style="font:16px/1.65 system-ui;max-width:760px;margin:48px auto;padding:0 24px;color:#183a31"><h1>Terms</h1><p>Use UniPaper Bridge only for lawful personal research and in accordance with the policies and licence terms of your institution and each publisher. The service constructs links but does not grant access rights, bypass authentication, or redistribute licensed content.</p><p>Do not automate bulk downloads or share institution-authenticated links, sessions, or downloaded files with unauthorised users. Metadata and availability information may be incomplete or change over time; verify the article, licence, and version at the source.</p><p><a href="/">Back</a></p></body></html>`;

export default {
  async fetch(request, env, ctx) {
    void ctx;
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname === MCP_PATH) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (url.pathname === MCP_PATH) {
      if (request.method !== "POST") {
        return jsonResponse(
          rpcError(null, -32000, "Method not allowed. Use POST for streamable HTTP."),
          405,
          { allow: "POST, OPTIONS" },
        );
      }
      return await handleMcp(request, env);
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
    }
    if (url.pathname === "/healthz") {
      return jsonResponse({ status: "ok", service: SERVER_NAME, version: SERVER_VERSION });
    }
    if (url.pathname === "/privacy") {
      return new Response(privacyPage, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/terms") {
      return new Response(termsPage, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
};
