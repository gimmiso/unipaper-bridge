import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
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
}

class FakeContext implements BrowserContextAdapter {
  constructor(readonly page: FakePage) {}
  async firstPage(): Promise<BrowserPageAdapter> {
    return this.page;
  }
  async waitUntilClosed(): Promise<void> {}
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
});
