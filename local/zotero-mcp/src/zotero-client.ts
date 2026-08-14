import { lstat, open, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const LOCAL_API_HEADERS = { "Zotero-API-Version": "3" };
const CONNECTOR_HEADERS = { "X-Zotero-Connector-API-Version": "3" };
const MAX_PDF_BYTES = 100 * 1024 * 1024;

export type AttachmentMode = "oa" | "metadata-only" | "user-pdf" | "licensed-pdf";

export interface PaperAuthor {
  first_name?: string;
  last_name?: string;
  name?: string;
}

export interface SavePaperInput {
  title: string;
  doi?: string;
  authors?: PaperAuthor[];
  year?: number;
  publication_title?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  abstract?: string;
  canonical_url?: string;
  language?: string;
  tags?: string[];
  attachment_mode: AttachmentMode;
  local_pdf_path?: string;
}

export interface ZoteroStatus {
  ready: boolean;
  api_running: boolean;
  connector_running: boolean;
  destination?: string;
  files_editable?: boolean;
  zotero_version?: string;
}

export interface SavePaperResult {
  status: "already_exists" | "saved_with_fulltext" | "saved_metadata_only";
  item_key?: string;
  duplicate: boolean;
  fulltext_attached: boolean;
  attachment_status: "present" | "saved" | "not-requested" | "unavailable";
  destination?: string;
}

interface ZoteroItem {
  key?: string;
  data?: {
    itemType?: string;
    title?: string;
    DOI?: string;
    date?: string;
    contentType?: string;
    filename?: string;
  };
}

interface SelectedTarget {
  libraryID?: number;
  id?: number | null;
  name?: string;
  libraryEditable?: boolean;
  filesEditable?: boolean;
  editable?: boolean;
}

type FetchLike = typeof fetch;

function normalizeDoi(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

function normalizeTitle(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function itemYear(item: ZoteroItem): number | undefined {
  const match = item.data?.date?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function verifyLocalPdf(path: string): Promise<Buffer> {
  const absolute = resolve(path);
  if (extname(absolute).toLowerCase() !== ".pdf") {
    throw new Error("local_pdf_must_end_in_pdf");
  }
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("local_pdf_must_be_regular_file");
  }
  if (stat.size < 5 || stat.size > MAX_PDF_BYTES) {
    throw new Error("local_pdf_size_invalid");
  }
  const handle = await open(absolute, "r");
  try {
    const header = Buffer.alloc(5);
    await handle.read(header, 0, header.length, 0);
    if (header.toString("ascii") !== "%PDF-") {
      throw new Error("local_file_is_not_pdf");
    }
  } finally {
    await handle.close();
  }
  return await readFile(absolute);
}

export class ZoteroLocalClient {
  constructor(
    private readonly baseURL = "http://127.0.0.1:23119",
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    const parsed = new URL(baseURL);
    if (
      parsed.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    ) {
      throw new Error("zotero_base_must_be_localhost");
    }
  }

  private async request(
    path: string,
    init: RequestInit = {},
    connector = false,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(
      connector ? CONNECTOR_HEADERS : LOCAL_API_HEADERS,
    )) {
      if (!headers.has(key)) headers.set(key, value);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseURL}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("zotero_unavailable");
    }
    if (!response.ok) throw new Error(`zotero_http_${response.status}`);
    return response;
  }

  private async connectorJson(path: string, payload: unknown): Promise<unknown> {
    const response = await this.request(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      true,
    );
    return await parseJson(response);
  }

  private async selectedTarget(): Promise<SelectedTarget> {
    return (await this.connectorJson(
      "/connector/getSelectedCollection",
      {},
    )) as SelectedTarget;
  }

  async status(): Promise<ZoteroStatus> {
    let api: Response | undefined;
    let connector: Response | undefined;
    try {
      api = await this.request("/api/");
    } catch {
      // Report both readiness gates below.
    }
    try {
      connector = await this.request("/connector/ping", {}, true);
    } catch {
      // Report both readiness gates below.
    }
    let target: SelectedTarget | undefined;
    if (api?.ok && connector?.ok) {
      try {
        target = await this.selectedTarget();
      } catch {
        // Target details are optional in a readiness response.
      }
    }
    return {
      ready: Boolean(api?.ok && connector?.ok && target?.editable),
      api_running: Boolean(api?.ok),
      connector_running: Boolean(connector?.ok),
      destination: target?.name,
      files_editable: target?.filesEditable,
      zotero_version:
        api?.headers.get("X-Zotero-Version") ??
        connector?.headers.get("X-Zotero-Version") ??
        undefined,
    };
  }

  private async search(query: string): Promise<ZoteroItem[]> {
    const params = new URLSearchParams({ q: query, limit: "100" });
    const response = await this.request(`/api/users/0/items/top?${params}`);
    const body = await parseJson(response);
    return Array.isArray(body) ? (body as ZoteroItem[]) : [];
  }

  private async findExact(input: SavePaperInput): Promise<ZoteroItem | undefined> {
    const doi = normalizeDoi(input.doi);
    if (doi) {
      const byDoi = await this.search(doi);
      const exact = byDoi.find((item) => normalizeDoi(item.data?.DOI) === doi);
      if (exact) return exact;
    }

    const title = normalizeTitle(input.title);
    const byTitle = await this.search(input.title);
    return byTitle.find((item) => {
      if (normalizeTitle(item.data?.title) !== title) return false;
      const existingYear = itemYear(item);
      return !input.year || !existingYear || input.year === existingYear;
    });
  }

  private async hasPdf(itemKey: string | undefined): Promise<boolean> {
    if (!itemKey) return false;
    const response = await this.request(
      `/api/users/0/items/${encodeURIComponent(itemKey)}/children`,
    );
    const body = await parseJson(response);
    if (!Array.isArray(body)) return false;
    return (body as ZoteroItem[]).some(
      (item) =>
        item.data?.itemType === "attachment" &&
        (item.data.contentType === "application/pdf" ||
          item.data.filename?.toLowerCase().endsWith(".pdf")),
    );
  }

  private zoteroItem(input: SavePaperInput, connectorID: string) {
    const reservedTags = new Set([
      "fulltext-oa",
      "fulltext-licensed",
      "fulltext-user",
      "needs-fulltext",
    ]);
    const tags = Array.from(
      new Set(
        ["unipaper-auto", ...(input.tags ?? [])]
          .map((tag) => tag.trim())
          .filter((tag) => tag && !reservedTags.has(tag.toLowerCase())),
      ),
    ).map((tag) => ({ tag }));
    const creators = (input.authors ?? []).map((author) =>
      author.name
        ? { creatorType: "author", name: author.name }
        : {
            creatorType: "author",
            firstName: author.first_name ?? "",
            lastName: author.last_name ?? "",
          },
    );
    const doi = normalizeDoi(input.doi);
    const canonicalURL =
      input.canonical_url ?? (doi ? `https://doi.org/${doi}` : undefined);
    return {
      id: connectorID,
      itemType: "journalArticle",
      title: input.title,
      creators,
      date: input.year ? String(input.year) : "",
      publicationTitle: input.publication_title ?? "",
      volume: input.volume ?? "",
      issue: input.issue ?? "",
      pages: input.pages ?? "",
      DOI: doi,
      url: canonicalURL ?? "",
      abstractNote: input.abstract ?? "",
      language: input.language ?? "",
      accessDate: "CURRENT_TIMESTAMP",
      tags,
    };
  }

  private async attachUserPdf(
    sessionID: string,
    connectorID: string,
    input: SavePaperInput,
  ): Promise<boolean> {
    if (!input.local_pdf_path) throw new Error("local_pdf_path_required");
    const pdf = await verifyLocalPdf(input.local_pdf_path);
    const doi = normalizeDoi(input.doi);
    const metadata = {
      sessionID,
      parentItemID: connectorID,
      title: "Full Text PDF",
      url: input.canonical_url ?? (doi ? `https://doi.org/${doi}` : "urn:unipaper:user-pdf"),
    };
    await this.request(
      `/connector/saveAttachment?sessionID=${encodeURIComponent(sessionID)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/pdf",
          "X-Metadata": JSON.stringify(metadata),
        },
        body: Uint8Array.from(pdf),
      },
      true,
    );
    return true;
  }

  private async attachOpenAccess(
    sessionID: string,
    connectorID: string,
  ): Promise<boolean> {
    const payload = { sessionID, itemID: connectorID };
    const available = await this.connectorJson(
      "/connector/hasAttachmentResolvers",
      payload,
    );
    if (available !== true) return false;
    try {
      await this.connectorJson("/connector/saveAttachmentFromResolver", payload);
      return true;
    } catch {
      return false;
    }
  }

  private async updateAccessTag(
    sessionID: string,
    target: SelectedTarget,
    input: SavePaperInput,
    attached: boolean,
  ): Promise<void> {
    if (!target.libraryID) return;
    const targetID = target.id ? `C${target.id}` : `L${target.libraryID}`;
    const accessTag = attached
      ? input.attachment_mode === "oa"
        ? "fulltext-oa"
        : input.attachment_mode === "licensed-pdf"
          ? "fulltext-licensed"
          : "fulltext-user"
      : "needs-fulltext";
    const tags = Array.from(
      new Set([
        ...(input.tags ?? []).filter(
          (tag) =>
            ![
              "fulltext-oa",
              "fulltext-licensed",
              "fulltext-user",
              "needs-fulltext",
            ].includes(
              tag.trim().toLowerCase(),
            ),
        ),
        accessTag,
      ]),
    );
    await this.connectorJson("/connector/updateSession", {
      sessionID,
      target: targetID,
      tags,
      note: "",
    });
  }

  async savePaper(input: SavePaperInput): Promise<SavePaperResult> {
    if (
      !["user-pdf", "licensed-pdf"].includes(input.attachment_mode) &&
      input.local_pdf_path
    ) {
      throw new Error("local_pdf_path_requires_local_pdf_mode");
    }
    const target = await this.selectedTarget();
    if (!target.editable || !target.libraryEditable) {
      throw new Error("zotero_destination_not_editable");
    }
    if (input.attachment_mode !== "metadata-only" && !target.filesEditable) {
      throw new Error("zotero_files_not_editable");
    }

    const existing = await this.findExact(input);
    if (existing) {
      const fulltext = await this.hasPdf(existing.key);
      return {
        status: "already_exists",
        item_key: existing.key,
        duplicate: true,
        fulltext_attached: fulltext,
        attachment_status: fulltext ? "present" : "unavailable",
        destination: target.name,
      };
    }

    const sessionID = `unipaper-${randomUUID()}`;
    const connectorID = `paper-${randomUUID()}`;
    const item = this.zoteroItem(input, connectorID);
    await this.connectorJson("/connector/saveItems", {
      sessionID,
      uri: item.url || "https://doi.org/",
      items: [item],
    });

    let attached = false;
    if (["user-pdf", "licensed-pdf"].includes(input.attachment_mode)) {
      try {
        attached = await this.attachUserPdf(sessionID, connectorID, input);
      } catch {
        attached = false;
      }
    } else if (input.attachment_mode === "oa") {
      attached = await this.attachOpenAccess(sessionID, connectorID);
    }
    await this.updateAccessTag(sessionID, target, input, attached);

    let saved: ZoteroItem | undefined;
    for (let attempt = 0; attempt < 10 && !saved; attempt += 1) {
      saved = await this.findExact(input);
      if (!saved) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    const confirmedPdf = attached || (await this.hasPdf(saved?.key));
    return {
      status: confirmedPdf ? "saved_with_fulltext" : "saved_metadata_only",
      item_key: saved?.key,
      duplicate: false,
      fulltext_attached: confirmedPdf,
      attachment_status:
        input.attachment_mode === "metadata-only"
          ? "not-requested"
          : confirmedPdf
            ? "saved"
            : "unavailable",
      destination: target.name,
    };
  }
}
