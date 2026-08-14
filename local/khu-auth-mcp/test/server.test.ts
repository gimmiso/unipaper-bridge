import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  createKHULocalServer,
  type KHUHelperLauncher,
} from "../src/server.js";

class RecordingLauncher implements KHUHelperLauncher {
  readonly calls: string[] = [];
  readonly fetches: Array<{ accessURL: string; destination: string }> = [];

  async launch(accessURL: string): Promise<void> {
    this.calls.push(accessURL);
  }

  async fetch(accessURL: string, destination: string): Promise<void> {
    this.fetches.push({ accessURL, destination });
    await writeFile(destination, minimalPdf("UniPaper evidence DOI 10.1000/example"));
  }
}

class DeferredLauncher implements KHUHelperLauncher {
  private unblockFetch!: () => void;
  private readonly gate = new Promise<void>((resolveGate) => {
    this.unblockFetch = resolveGate;
  });
  destination: string | undefined;

  async launch(): Promise<void> {}

  async fetch(_accessURL: string, destination: string): Promise<void> {
    this.destination = destination;
    await this.gate;
    await writeFile(destination, minimalPdf("Deferred DOI 10.1000/deferred"));
  }

  finish(): void {
    this.unblockFetch();
  }
}

function minimalPdf(text: string): Buffer {
  const escaped = text.replace(/[()\\]/g, (character) => `\\${character}`);
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

describe("KHU local MCP security boundary", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function connectedClient(launcher: KHUHelperLauncher) {
    const server = createKHULocalServer(launcher);
    const client = new Client({ name: "khu-local-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closers.push(async () => {
      await client.close();
      await server.close();
    });
    return client;
  }

  it("exposes the one-paper lifecycle and no credential getter", async () => {
    const client = await connectedClient(new RecordingLauncher());
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name)).toEqual([
      "fetch_khu_paper",
      "check_khu_paper_fetch",
      "read_khu_paper_pages",
      "release_khu_paper",
      "open_khu_paper",
    ]);
    expect(JSON.stringify(result.tools)).not.toMatch(/get.*password|credential.*value/i);
  });

  it("downloads, validates, reads, and releases exactly one managed PDF", async () => {
    const launcher = new RecordingLauncher();
    const client = await connectedClient(launcher);
    const started = await client.callTool({
      name: "fetch_khu_paper",
      arguments: {
        institution_id: "khu-seoul",
        target_url: "https://doi.org/10.1000/example",
        expected_doi: "10.1000/example",
      },
    });

    expect(started.isError).not.toBe(true);
    expect(started.structuredContent).toMatchObject({
      status: "fetching",
      credential_exposed: false,
    });
    const downloadId = (started.structuredContent as { download_id: string }).download_id;
    let fetched = await client.callTool({
      name: "check_khu_paper_fetch",
      arguments: { download_id: downloadId },
    });
    for (let attempt = 0; attempt < 50 && fetched.structuredContent?.status === "fetching"; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      fetched = await client.callTool({
        name: "check_khu_paper_fetch",
        arguments: { download_id: downloadId },
      });
    }
    expect(fetched.isError, JSON.stringify(fetched)).not.toBe(true);
    expect(launcher.fetches).toHaveLength(1);
    const fetchedData = fetched.structuredContent as {
      download_id: string;
      local_pdf_path: string;
      identity_status: string;
      credential_exposed: boolean;
    };
    expect(fetchedData.local_pdf_path).toMatch(/unipaper-khu-.+paper\.pdf$/);
    expect(fetchedData.credential_exposed).toBe(false);
    expect(fetchedData.identity_status).toBe("matched");

    const read = await client.callTool({
      name: "read_khu_paper_pages",
      arguments: { download_id: fetchedData.download_id, start_page: 1, page_count: 1 },
    });
    expect(read.isError).not.toBe(true);
    expect(JSON.stringify(read.structuredContent)).toContain("UniPaper evidence");

    const released = await client.callTool({
      name: "release_khu_paper",
      arguments: { download_id: fetchedData.download_id },
    });
    expect(released.structuredContent).toEqual({
      status: "released",
      credential_exposed: false,
    });

    const afterRelease = await client.callTool({
      name: "read_khu_paper_pages",
      arguments: { download_id: fetchedData.download_id, start_page: 1, page_count: 1 },
    });
    expect(afterRelease.isError).toBe(true);
  });

  it("returns before browser work finishes and blocks overlapping jobs", async () => {
    const launcher = new DeferredLauncher();
    const client = await connectedClient(launcher);
    const started = await client.callTool({
      name: "fetch_khu_paper",
      arguments: {
        institution_id: "khu-seoul",
        target_url: "https://doi.org/10.1000/deferred",
        expected_doi: "10.1000/deferred",
      },
    });
    const downloadId = (started.structuredContent as { download_id: string }).download_id;
    expect(started.structuredContent).toMatchObject({ status: "fetching" });
    expect(launcher.destination).toMatch(/paper\.pdf$/);

    const overlapping = await client.callTool({
      name: "fetch_khu_paper",
      arguments: {
        institution_id: "khu-seoul",
        target_url: "https://doi.org/10.1000/overlap",
      },
    });
    expect(overlapping.isError).toBe(true);

    launcher.finish();
    let checked = await client.callTool({
      name: "check_khu_paper_fetch",
      arguments: { download_id: downloadId },
    });
    for (let attempt = 0; attempt < 50 && checked.structuredContent?.status === "fetching"; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      checked = await client.callTool({
        name: "check_khu_paper_fetch",
        arguments: { download_id: downloadId },
      });
    }
    expect(checked.structuredContent).toMatchObject({
      status: "downloaded",
      identity_status: "matched",
    });
    const released = await client.callTool({
      name: "release_khu_paper",
      arguments: { download_id: downloadId },
    });
    expect(released.isError).not.toBe(true);
  });

  it("returns only a safe launch status", async () => {
    const launcher = new RecordingLauncher();
    const client = await connectedClient(launcher);
    const marker = "must-not-return-this-input";
    const result = await client.callTool({
      name: "open_khu_paper",
      arguments: {
        institution_id: "khu-seoul",
        target_url: `https://doi.org/10.1000/example?marker=${marker}`,
      },
    });
    const serialized = JSON.stringify(result);

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      status: "browser_opened",
      credential_exposed: false,
    });
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toMatch(/password|account|username/i);
    expect(launcher.calls).toHaveLength(1);
    expect(launcher.calls[0]).toContain("openlink.khu.ac.kr/link.n2s?url=");
  });

  it("does not reflect helper errors back to the model", async () => {
    const secret = "secret-from-an-underlying-error";
    const client = await connectedClient({
      async launch() {
        throw new Error(secret);
      },
      async fetch() {
        throw new Error(secret);
      },
    });
    const result = await client.callTool({
      name: "open_khu_paper",
      arguments: {
        institution_id: "khu-global",
        target_url: "https://doi.org/10.1000/example",
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.structuredContent).toEqual({
      status: "error",
      code: "local_helper_unavailable",
      credential_exposed: false,
    });
  });

  it("rejects private and nested proxy targets before launching", async () => {
    const launcher = new RecordingLauncher();
    const client = await connectedClient(launcher);
    for (const target_url of [
      "http://127.0.0.1/admin",
      "http://[::1]/admin",
      "http://2130706433/admin",
      "https://webgate.khu.ac.kr/link.n2s?url=https://example.com",
      "file:///etc/passwd",
    ]) {
      const result = await client.callTool({
        name: "open_khu_paper",
        arguments: { institution_id: "khu-seoul", target_url },
      });
      expect(result.isError).toBe(true);
    }
    expect(launcher.calls).toEqual([]);
  });
});
