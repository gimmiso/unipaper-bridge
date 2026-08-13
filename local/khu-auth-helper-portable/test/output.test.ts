import { describe, expect, it } from "vitest";
import type { BrowserAdapter } from "../src/browser.js";
import { runCLI, type CLIDependencies } from "../src/cli.js";
import type { CredentialStore } from "../src/models.js";

describe("portable helper public output", () => {
  it("never reflects an underlying secret-bearing error", async () => {
    const secret = "secret-from-vault-error";
    let output = "";
    const dependencies: CLIDependencies = {
      platform: "linux",
      browser: {} as BrowserAdapter,
      accountPrompt: async () => "unused",
      secretPrompt: async () => "unused",
      writeOutput: (value) => {
        output += value;
      },
      store: {
        async replace() {},
        async status() {
          throw new Error(secret);
        },
        async load() {
          throw new Error(secret);
        },
        async remove() {},
      } as CredentialStore,
    };

    await expect(runCLI(["status"], dependencies)).resolves.toBe(1);
    expect(output).not.toContain(secret);
    expect(output).not.toMatch(/password|account|username/i);
    expect(JSON.parse(output)).toEqual({
      status: "error",
      credential_exposed: false,
      code: "vault_unavailable",
    });
  });
});
