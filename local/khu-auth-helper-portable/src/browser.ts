import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { BrowserContext, Download, Page, Response } from "playwright";
import {
  isKHULoginURL,
  validateKHUAccessURL,
  validatePublicDownloadURL,
} from "./access-url.js";
import { HelperError, type CredentialStore, type SupportedPlatform } from "./models.js";

export interface BrowserAdapter {
  launchPersistent(profileDirectory: string): Promise<BrowserContextAdapter>;
}

export interface BrowserContextAdapter {
  firstPage(): Promise<BrowserPageAdapter>;
  waitUntilClosed(): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserPageAdapter {
  navigate(url: string): Promise<void>;
  currentURL(): string;
  waitForRedirect(): Promise<void>;
  submitCredential(account: string, password: string): Promise<void>;
  downloadSinglePDF(destination: string): Promise<void>;
}

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1_000;

interface PdfCandidate {
  href?: string;
  index: number;
  score: number;
}

async function validateDestination(rawDestination: string): Promise<string> {
  if (
    !isAbsolute(rawDestination) ||
    extname(rawDestination).toLowerCase() !== ".pdf" ||
    basename(rawDestination) !== "paper.pdf" ||
    !basename(dirname(rawDestination)).startsWith("unipaper-khu-")
  ) {
    throw new HelperError("invalid_arguments");
  }
  const destination = resolve(rawDestination);
  const parent = await lstat(dirname(destination));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new HelperError("invalid_arguments");
  }
  return destination;
}

function isPdfBytes(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

class PlaywrightPageAdapter implements BrowserPageAdapter {
  constructor(private readonly page: Page) {}

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }

  currentURL(): string {
    return this.page.url();
  }

  async waitForRedirect(): Promise<void> {
    const initialHost = new URL(this.page.url()).hostname;
    await this.page
      .waitForURL((url) => url.hostname !== initialHost, {
        timeout: 15_000,
        waitUntil: "domcontentloaded",
      })
      .catch(() => undefined);
  }

  async submitCredential(account: string, password: string): Promise<void> {
    if (!isKHULoginURL(this.page.url())) {
      throw new HelperError("authentication_cancelled");
    }
    const idField = this.page.locator("#id");
    const passwordField = this.page.locator("#password");
    const submitButton = this.page.locator('#login button[type="submit"]');
    await idField.waitFor({ state: "visible", timeout: 15_000 });
    await passwordField.waitFor({ state: "visible", timeout: 15_000 });
    await idField.fill(account);
    await passwordField.fill(password);
    await submitButton.click();
  }

  async downloadSinglePDF(rawDestination: string): Promise<void> {
    const destination = await validateDestination(rawDestination);
    const context = this.page.context();
    const attemptedURLs = new Set<string>();
    const clickedCandidates = new Set<string>();
    let saving = false;
    let completed = false;
    let resolveCaptured!: () => void;
    const captured = new Promise<void>((resolveCapture) => {
      resolveCaptured = resolveCapture;
    });

    const saveBytes = async (bytes: Buffer) => {
      if (completed || saving || !isPdfBytes(bytes) || bytes.length > MAX_PDF_BYTES) return;
      saving = true;
      try {
        await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
        completed = true;
        resolveCaptured();
      } catch {
        // A competing response or download may have won the race. The local MCP
        // validates the final file before exposing its managed identifier.
      } finally {
        saving = false;
      }
    };

    const saveDownload = async (download: Download) => {
      if (completed || saving) return;
      try {
        validatePublicDownloadURL(download.url());
      } catch {
        return;
      }
      saving = true;
      try {
        await download.saveAs(destination);
        const bytes = await readFile(destination);
        if (!isPdfBytes(bytes) || bytes.length > MAX_PDF_BYTES) {
          await rm(destination, { force: true });
          return;
        }
        completed = true;
        resolveCaptured();
      } catch {
        // Keep observing the isolated browser for another PDF response.
      } finally {
        saving = false;
      }
    };

    const saveResponse = async (response: Response) => {
      if (completed || saving) return;
      try {
        validatePublicDownloadURL(response.url());
      } catch {
        return;
      }
      const headers: Record<string, string> = await response
        .allHeaders()
        .catch(() => ({}));
      const contentType = headers["content-type"]?.toLowerCase() ?? "";
      const disposition = headers["content-disposition"]?.toLowerCase() ?? "";
      if (!contentType.includes("application/pdf") && !disposition.includes(".pdf")) {
        return;
      }
      const declaredLength = Number(headers["content-length"] ?? 0);
      if (declaredLength > MAX_PDF_BYTES) return;
      const bytes = await response.body().catch(() => undefined);
      if (bytes) await saveBytes(bytes);
    };

    const observedPages = new Set<Page>();
    const observePage = (page: Page) => {
      if (observedPages.has(page)) return;
      observedPages.add(page);
      page.on("download", (download) => void saveDownload(download));
      page.on("response", (response) => void saveResponse(response));
    };
    context.pages().forEach(observePage);
    context.on("page", observePage);

    const showLocalNotice = async (page: Page) => {
      await page
        .evaluate(() => {
          if (document.getElementById("unipaper-local-download-notice")) return;
          const notice = document.createElement("div");
          notice.id = "unipaper-local-download-notice";
          notice.textContent =
            "UniPaper가 이 논문의 PDF 1편을 찾는 중입니다. 자동으로 찾지 못하면 이 페이지의 PDF 버튼을 한 번 눌러 주세요.";
          Object.assign(notice.style, {
            position: "fixed",
            zIndex: "2147483647",
            left: "16px",
            right: "16px",
            bottom: "16px",
            padding: "12px 16px",
            borderRadius: "10px",
            background: "#172554",
            color: "#ffffff",
            font: "14px system-ui, sans-serif",
            boxShadow: "0 4px 18px rgba(0,0,0,.3)",
          });
          document.documentElement.appendChild(notice);
        })
        .catch(() => undefined);
    };

    const candidatesFor = async (page: Page): Promise<PdfCandidate[]> =>
      page
        .evaluate(() => {
          const scored: Array<{ href?: string; index: number; score: number }> = [];
          if (/(?:\.pdf(?:[?#]|$)|\/pdf(?:[/?#]|$)|pdfdownload)/i.test(location.href)) {
            scored.push({ href: location.href, index: -1, score: 1_100 });
          }
          const meta = document.querySelector<HTMLMetaElement>(
            'meta[name="citation_pdf_url" i]',
          );
          if (meta?.content) scored.push({ href: meta.content, index: -1, score: 1_000 });

          const elements = Array.from(
            document.querySelectorAll<HTMLElement>('a[href], button, [role="button"]'),
          );
          elements.forEach((element, index) => {
            const anchor = element instanceof HTMLAnchorElement ? element : undefined;
            const href = anchor?.href;
            const label = [
              element.textContent,
              element.getAttribute("aria-label"),
              element.getAttribute("title"),
              href,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            let score = 0;
            if (/download\s*(full\s*text\s*)?pdf|pdf\s*download|pdf\s*다운로드/.test(label)) score += 500;
            if (/view\s*(full\s*text\s*)?pdf|full\s*text\s*pdf|원문\s*보기/.test(label)) score += 420;
            if (/\bpdf\b/.test(label)) score += 250;
            if (href && /(?:\.pdf(?:[?#]|$)|\/pdf(?:[/?#]|$)|pdfdownload)/i.test(href)) score += 300;
            if (anchor?.hasAttribute("download")) score += 250;
            if (/supplement|supporting|appendix|dataset|citation/.test(label)) score -= 700;
            if (score > 0) scored.push({ href, index, score });
          });
          return scored.sort((left, right) => right.score - left.score).slice(0, 8);
        })
        .catch(() => []);

    const tryCandidate = async (page: Page, candidate: PdfCandidate) => {
      if (completed) return;
      if (candidate.href && !attemptedURLs.has(candidate.href)) {
        attemptedURLs.add(candidate.href);
        try {
          const candidateURL = validatePublicDownloadURL(candidate.href);
          const response = await context.request.get(candidateURL.toString(), {
            failOnStatusCode: false,
            timeout: 45_000,
          });
          validatePublicDownloadURL(response.url());
          const bytes = await response.body();
          if (isPdfBytes(bytes)) {
            await saveBytes(bytes);
            return;
          }
        } catch {
          // Signed POST downloads and script-generated URLs need a real click.
        }
      }

      const clickKey = `${page.url()}#${candidate.index}`;
      if (
        candidate.href &&
        candidate.index >= 0 &&
        !clickedCandidates.has(clickKey)
      ) {
        try {
          validatePublicDownloadURL(candidate.href);
        } catch {
          return;
        }
        clickedCandidates.add(clickKey);
        const elements = page.locator('a[href], button, [role="button"]');
        await elements
          .nth(candidate.index)
          .click({ timeout: 10_000 })
          .catch(() => undefined);
      }
    };

    const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
    while (!completed && Date.now() < deadline) {
      const pages = context.pages();
      pages.forEach(observePage);
      for (const page of pages) {
        if (page.isClosed() || isKHULoginURL(page.url())) continue;
        await showLocalNotice(page);
        const candidates = await candidatesFor(page);
        for (const candidate of candidates) {
          await tryCandidate(page, candidate);
          if (completed) break;
        }
        if (completed) break;
      }
      if (!completed) {
        await Promise.race([
          captured,
          new Promise<void>((resolveWait) => setTimeout(resolveWait, 1_500)),
        ]);
      }
    }

    context.removeListener("page", observePage);
    if (!completed) throw new HelperError("download_timeout");
  }
}

class PlaywrightContextAdapter implements BrowserContextAdapter {
  constructor(private readonly context: BrowserContext) {}

  async firstPage(): Promise<BrowserPageAdapter> {
    const page = this.context.pages()[0] ?? (await this.context.newPage());
    return new PlaywrightPageAdapter(page);
  }

  async waitUntilClosed(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.context.once("close", () => resolve());
    });
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}

export class PlaywrightBrowserAdapter implements BrowserAdapter {
  async launchPersistent(profileDirectory: string): Promise<BrowserContextAdapter> {
    try {
      const { chromium } = await import("playwright");
      const context = await chromium.launchPersistentContext(profileDirectory, {
        headless: false,
        viewport: null,
      });
      return new PlaywrightContextAdapter(context);
    } catch {
      throw new HelperError("browser_launch_failed");
    }
  }
}

export function browserProfileDirectory(
  platform: SupportedPlatform,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA?.trim();
    if (!localAppData) throw new HelperError("vault_unavailable");
    return join(localAppData, "UniPaper", "KHU Browser");
  }
  const dataHome = environment.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  return join(dataHome, "unipaper", "khu-browser");
}

export interface OpenResult {
  authentication: "existing_session" | "credential_submitted" | "manual_login";
}

interface PreparedBrowser {
  context: BrowserContextAdapter;
  page: BrowserPageAdapter;
  authentication: OpenResult["authentication"];
}

async function prepareKHUAccess(
  rawAccessURL: string,
  store: CredentialStore,
  browser: BrowserAdapter,
  platform: SupportedPlatform,
  environment: NodeJS.ProcessEnv,
): Promise<PreparedBrowser> {
  const accessURL = validateKHUAccessURL(rawAccessURL);
  const profileDirectory = browserProfileDirectory(platform, environment);
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 });

  const context = await browser.launchPersistent(profileDirectory);
  const page = await context.firstPage();
  await page.navigate(accessURL.toString());
  await page.waitForRedirect();

  let authentication: OpenResult["authentication"] = "existing_session";
  if (isKHULoginURL(page.currentURL())) {
    try {
      const credential = await store.load();
      try {
        try {
          await page.submitCredential(credential.account, credential.password);
          authentication = "credential_submitted";
          await page.waitForRedirect();
        } catch {
          authentication = "manual_login";
        }
      } finally {
        credential.password = "";
        credential.account = "";
      }
    } catch (error) {
      if (error instanceof HelperError) authentication = "manual_login";
      else throw error;
    }
  }
  return { context, page, authentication };
}

export async function openKHUAccess(
  rawAccessURL: string,
  store: CredentialStore,
  browser: BrowserAdapter,
  platform: SupportedPlatform,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<OpenResult> {
  const { context, authentication } = await prepareKHUAccess(
    rawAccessURL,
    store,
    browser,
    platform,
    environment,
  );
  await context.waitUntilClosed();
  return { authentication };
}

export async function fetchKHUAccess(
  rawAccessURL: string,
  destination: string,
  store: CredentialStore,
  browser: BrowserAdapter,
  platform: SupportedPlatform,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<OpenResult> {
  const { context, page, authentication } = await prepareKHUAccess(
    rawAccessURL,
    store,
    browser,
    platform,
    environment,
  );
  try {
    await page.downloadSinglePDF(destination);
    return { authentication };
  } finally {
    await context.close().catch(() => undefined);
  }
}
