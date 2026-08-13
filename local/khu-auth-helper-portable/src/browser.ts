import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { isKHULoginURL, validateKHUAccessURL } from "./access-url.js";
import { HelperError, type CredentialStore, type SupportedPlatform } from "./models.js";

export interface BrowserAdapter {
  launchPersistent(profileDirectory: string): Promise<BrowserContextAdapter>;
}

export interface BrowserContextAdapter {
  firstPage(): Promise<BrowserPageAdapter>;
  waitUntilClosed(): Promise<void>;
}

export interface BrowserPageAdapter {
  navigate(url: string): Promise<void>;
  currentURL(): string;
  waitForRedirect(): Promise<void>;
  submitCredential(account: string, password: string): Promise<void>;
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

export async function openKHUAccess(
  rawAccessURL: string,
  store: CredentialStore,
  browser: BrowserAdapter,
  platform: SupportedPlatform,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<OpenResult> {
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
        } catch {
          // If KHU changes its form, leave the isolated browser open so the user
          // can sign in manually. Never reflect browser errors or form contents.
          authentication = "manual_login";
        }
      } finally {
        credential.password = "";
        credential.account = "";
      }
    } catch (error) {
      if (error instanceof HelperError) {
        authentication = "manual_login";
      } else {
        throw error;
      }
    }
  }

  await context.waitUntilClosed();
  return { authentication };
}
