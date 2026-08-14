import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_PAGE_TEXT_CHARS = 20_000;

export interface PaperAllocation {
  downloadId: string;
  directory: string;
  pdfPath: string;
}

export interface VerifiedPaper {
  downloadId: string;
  pdfPath: string;
  sizeBytes: number;
  sha256: string;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  truncated: boolean;
}

export interface ExtractedPages {
  totalPages: number;
  pages: ExtractedPage[];
}

interface PaperRecord extends PaperAllocation {
  verified?: VerifiedPaper;
}

async function validatePdfPath(pdfPath: string): Promise<{ sizeBytes: number; sha256: string }> {
  if (extname(pdfPath).toLowerCase() !== ".pdf") {
    throw new Error("download_invalid");
  }

  const fileStat = await lstat(pdfPath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error("download_invalid");
  }
  if (fileStat.size < 5 || fileStat.size > MAX_PDF_BYTES) {
    throw new Error("download_invalid");
  }

  const canonicalParent = await realpath(dirname(pdfPath));
  const canonicalFile = await realpath(pdfPath);
  if (resolve(canonicalParent, basename(pdfPath)) !== canonicalFile) {
    throw new Error("download_invalid");
  }

  const file = await open(pdfPath, "r");
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== 5 || header.toString("ascii") !== "%PDF-") {
      throw new Error("download_invalid");
    }
  } finally {
    await file.close();
  }

  const bytes = await readFile(pdfPath);
  return {
    sizeBytes: fileStat.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export class ManagedPaperStore {
  private readonly records = new Map<string, PaperRecord>();

  constructor(private readonly temporaryRoot = tmpdir()) {}

  async allocate(): Promise<PaperAllocation> {
    await mkdir(this.temporaryRoot, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.temporaryRoot, "unipaper-khu-"));
    const allocation = {
      downloadId: randomUUID(),
      directory,
      pdfPath: join(directory, "paper.pdf"),
    };
    this.records.set(allocation.downloadId, allocation);
    return allocation;
  }

  async verify(downloadId: string): Promise<VerifiedPaper> {
    const record = this.records.get(downloadId);
    if (!record) throw new Error("download_not_found");
    if (record.verified) return record.verified;

    const validation = await validatePdfPath(record.pdfPath);
    const verified = {
      downloadId,
      pdfPath: record.pdfPath,
      ...validation,
    };
    record.verified = verified;
    return verified;
  }

  async readPages(
    downloadId: string,
    startPage: number,
    pageCount: number,
  ): Promise<ExtractedPages> {
    const paper = await this.verify(downloadId);
    const bytes = new Uint8Array(await readFile(paper.pdfPath));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;
    try {
      if (startPage > document.numPages) {
        throw new Error("page_out_of_range");
      }
      const finalPage = Math.min(document.numPages, startPage + pageCount - 1);
      const pages: ExtractedPage[] = [];
      for (let pageNumber = startPage; pageNumber <= finalPage; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const fullText = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        pages.push({
          pageNumber,
          text: fullText.slice(0, MAX_PAGE_TEXT_CHARS),
          truncated: fullText.length > MAX_PAGE_TEXT_CHARS,
        });
      }
      return { totalPages: document.numPages, pages };
    } finally {
      await document.destroy();
    }
  }

  async release(downloadId: string): Promise<boolean> {
    const record = this.records.get(downloadId);
    if (!record) return false;
    this.records.delete(downloadId);
    await rm(record.directory, { recursive: true, force: true });
    return true;
  }
}
