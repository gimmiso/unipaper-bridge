import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { validatePublicDownloadURL } from "../src/access-url.js";
import {
  fetchKHUAccess,
  openKHUAccess,
  type BrowserAdapter,
  type BrowserContextAdapter,
  type BrowserPageAdapter,
} from "../src/browser.js";
import type {
  CredentialPayload,
  CredentialStatus,
  CredentialStore,
} from "../src/models.js";

class FakeStore implements CredentialStore {
  loads = 0;

  constructor(private readonly credential: CredentialPayload) {}

  async replace(): Promise<void> {}
  async status(): Promise<CredentialStatus> {
    return { configured: true, backend: "linux-secret-service" };
  }
  async load(): Promise<CredentialPayload> {
    this.loads += 1;
    return { ...this.credential };
  }
  async remove(): Promise<void> {}
}

class FakePage implements BrowserPageAdapter {
  submitted: { account: string; password: string } | undefined;
  downloadedDestination: string | undefined;

  constructor(
    private readonly destination: string,
    private readonly submitFailure = false,
  ) {}

  async navigate(): Promise<void> {}
  currentURL(): string {
    return this.destination;
  }
  async waitForRedirect(): Promise<void> {}
  async submitCredential(account: string, password: string): Promise<void> {
    if (this.submitFailure) throw new Error("page contents must remain private");
    this.submitted = { account, password };
  }
  async downloadSinglePDF(destination: string): Promise<void> {
    this.downloadedDestination = destination;
  }
}

class FakeContext implements BrowserContextAdapter {
  closed = false;
  constructor(readonly page: FakePage) {}
  async firstPage(): Promise<BrowserPageAdapter> {
    return this.page;
  }
  async waitUntilClosed(): Promise<void> {}
  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeBrowser implements BrowserAdapter {
  readonly context: FakeContext;

  constructor(destination: string, submitFailure = false) {
    this.context = new FakeContext(new FakePage(destination, submitFailure));
  }
  async launchPersistent(): Promise<BrowserContextAdapter> {
    return this.context;
  }
}

const accessURL =
  "https://openlink.khu.ac.kr/link.n2s?url=https%3A%2F%2Fdoi.org%2F10.1000%2Fexample";
const credential = {
  version: 1 as const,
  account: "2025999999",
  password: "local-only-password",
};
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryEnvironment() {
  const directory = await mkdtemp(join(tmpdir(), "unipaper-portable-test-"));
  cleanup.push(directory);
  return { XDG_DATA_HOME: directory };
}

describe("portable browser credential boundary", () => {
  it("allows only public or exact reviewed proxy PDF candidates", () => {
    expect(validatePublicDownloadURL("https://publisher.example/paper.pdf").hostname).toBe(
      "publisher.example",
    );
    expect(validatePublicDownloadURL(accessURL).hostname).toBe("openlink.khu.ac.kr");
    for (const candidate of [
      "http://127.0.0.1/paper.pdf",
      "http://2130706433/paper.pdf",
      "https://files.internal/paper.pdf",
      "file:///tmp/paper.pdf",
      "https://openlink.khu.ac.kr/link.n2s?url=http://127.0.0.1/paper.pdf",
    ]) {
      expect(() => validatePublicDownloadURL(candidate)).toThrow();
    }
  });

  it("does not load a credential when an existing session reaches the paper", async () => {
    const store = new FakeStore(credential);
    const browser = new FakeBrowser("https://doi.org/10.1000/example");
    const result = await openKHUAccess(
      accessURL,
      store,
      browser,
      "linux",
      await temporaryEnvironment(),
    );

    expect(result.authentication).toBe("existing_session");
    expect(store.loads).toBe(0);
    expect(browser.context.page.submitted).toBeUndefined();
  });

  it("loads and submits only after the exact KHU login origin is reached", async () => {
    const store = new FakeStore(credential);
    const browser = new FakeBrowser("https://lib.khu.ac.kr/login?retUrl=paper");
    const result = await openKHUAccess(
      accessURL,
      store,
      browser,
      "linux",
      await temporaryEnvironment(),
    );

    expect(result.authentication).toBe("credential_submitted");
    expect(store.loads).toBe(1);
    expect(browser.context.page.submitted).toEqual({
      account: credential.account,
      password: credential.password,
    });
  });

  it("falls back to manual login without reflecting a changed login form", async () => {
    const store = new FakeStore(credential);
    const browser = new FakeBrowser("https://lib.khu.ac.kr/login", true);
    const result = await openKHUAccess(
      accessURL,
      store,
      browser,
      "linux",
      await temporaryEnvironment(),
    );

    expect(result.authentication).toBe("manual_login");
    expect(store.loads).toBe(1);
  });

  it("hands one managed destination to the browser and closes after capture", async () => {
    const environment = await temporaryEnvironment();
    const managedDirectory = await mkdtemp(join(tmpdir(), "unipaper-khu-test-"));
    cleanup.push(managedDirectory);
    const destination = join(managedDirectory, "paper.pdf");
    const store = new FakeStore(credential);
    const browser = new FakeBrowser("https://publisher.example/article");

    const result = await fetchKHUAccess(
      accessURL,
      destination,
      store,
      browser,
      "linux",
      environment,
    );

    expect(result.authentication).toBe("existing_session");
    expect(browser.context.page.downloadedDestination).toBe(destination);
    expect(browser.context.closed).toBe(true);
  });
});
