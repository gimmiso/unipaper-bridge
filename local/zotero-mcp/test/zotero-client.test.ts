import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZoteroLocalClient } from "../src/zotero-client.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(value === null ? null : JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ZoteroLocalClient", () => {
  it("deduplicates by normalized DOI before writing", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("getSelectedCollection")) {
        return jsonResponse({
          libraryID: 1,
          id: null,
          name: "My Library",
          libraryEditable: true,
          filesEditable: true,
          editable: true,
        });
      }
      if (url.includes("/items/top?")) {
        return jsonResponse([
          {
            key: "EXISTING",
            data: {
              itemType: "journalArticle",
              title: "Existing Paper",
              DOI: "https://doi.org/10.1000/EXAMPLE",
              date: "2026",
            },
          },
        ]);
      }
      if (url.includes("/EXISTING/children")) {
        return jsonResponse([
          { data: { itemType: "attachment", contentType: "application/pdf" } },
        ]);
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;
    const client = new ZoteroLocalClient("http://127.0.0.1:23119", fetchImpl);

    const result = await client.savePaper({
      title: "Existing Paper",
      doi: "10.1000/example",
      year: 2026,
      attachment_mode: "oa",
    });

    expect(result).toMatchObject({
      status: "already_exists",
      item_key: "EXISTING",
      duplicate: true,
      fulltext_attached: true,
    });
    expect(calls.some((url) => url.includes("/connector/saveItems"))).toBe(false);
  });

  it("keeps metadata and applies needs-fulltext when OA attachment fails", async () => {
    let saved = false;
    let updatedTags: string[] = [];
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("getSelectedCollection")) {
        return jsonResponse({
          libraryID: 1,
          id: null,
          name: "My Library",
          libraryEditable: true,
          filesEditable: true,
          editable: true,
        });
      }
      if (url.includes("/items/top?")) {
        return jsonResponse(
          saved
            ? [
                {
                  key: "NEWITEM1",
                  data: {
                    itemType: "journalArticle",
                    title: "New OA Paper",
                    DOI: "10.1000/new",
                    date: "2026",
                  },
                },
              ]
            : [],
        );
      }
      if (url.endsWith("/connector/saveItems")) {
        saved = true;
        return jsonResponse(null, 201);
      }
      if (url.endsWith("/connector/hasAttachmentResolvers")) {
        return jsonResponse(true);
      }
      if (url.endsWith("/connector/saveAttachmentFromResolver")) {
        return jsonResponse({ error: "not found" }, 500);
      }
      if (url.endsWith("/connector/updateSession")) {
        updatedTags = (JSON.parse(String(init?.body)) as { tags: string[] }).tags;
        return jsonResponse({});
      }
      if (url.includes("/NEWITEM1/children")) return jsonResponse([]);
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;
    const client = new ZoteroLocalClient("http://127.0.0.1:23119", fetchImpl);

    const result = await client.savePaper({
      title: "New OA Paper",
      doi: "10.1000/new",
      year: 2026,
      tags: ["core-evidence", "fulltext-oa"],
      attachment_mode: "oa",
    });

    expect(result).toMatchObject({
      status: "saved_metadata_only",
      item_key: "NEWITEM1",
      fulltext_attached: false,
      attachment_status: "unavailable",
    });
    expect(updatedTags).toContain("core-evidence");
    expect(updatedTags).toContain("needs-fulltext");
    expect(updatedTags).not.toContain("fulltext-oa");
  });

  it("copies one managed institutional PDF and applies fulltext-licensed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unipaper-khu-zotero-test-"));
    const pdfPath = join(directory, "paper.pdf");
    await writeFile(pdfPath, Buffer.from("%PDF-1.4\nlicensed test\n%%EOF\n"));
    let saved = false;
    let updatedTags: string[] = [];
    let attachmentContentType = "";
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("getSelectedCollection")) {
        return jsonResponse({
          libraryID: 1,
          id: null,
          name: "My Library",
          libraryEditable: true,
          filesEditable: true,
          editable: true,
        });
      }
      if (url.includes("/items/top?")) {
        return jsonResponse(
          saved
            ? [
                {
                  key: "LICENSED1",
                  data: {
                    itemType: "journalArticle",
                    title: "Licensed Paper",
                    DOI: "10.1000/licensed",
                    date: "2026",
                  },
                },
              ]
            : [],
        );
      }
      if (url.endsWith("/connector/saveItems")) {
        saved = true;
        return jsonResponse(null, 201);
      }
      if (url.includes("/connector/saveAttachment?")) {
        attachmentContentType = new Headers(init?.headers).get("Content-Type") ?? "";
        return jsonResponse(null, 201);
      }
      if (url.endsWith("/connector/updateSession")) {
        updatedTags = (JSON.parse(String(init?.body)) as { tags: string[] }).tags;
        return jsonResponse({});
      }
      if (url.includes("/LICENSED1/children")) {
        return jsonResponse([
          { data: { itemType: "attachment", contentType: "application/pdf" } },
        ]);
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    try {
      const client = new ZoteroLocalClient("http://127.0.0.1:23119", fetchImpl);
      const result = await client.savePaper({
        title: "Licensed Paper",
        doi: "10.1000/licensed",
        year: 2026,
        attachment_mode: "licensed-pdf",
        local_pdf_path: pdfPath,
      });

      expect(result).toMatchObject({
        status: "saved_with_fulltext",
        fulltext_attached: true,
      });
      expect(attachmentContentType).toBe("application/pdf");
      expect(updatedTags).toContain("fulltext-licensed");
      expect(updatedTags).not.toContain("fulltext-user");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
