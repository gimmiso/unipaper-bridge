import {
  HelperError,
  type CredentialPayload,
  type CredentialStatus,
  type CredentialStore,
  validateCredential,
} from "./models.js";
import type { CommandRunner } from "./command-runner.js";

const BACKEND = "linux-secret-service" as const;
const ATTRIBUTES = ["service", "com.gimmiso.unipaper.khu"];

export class LinuxSecretServiceStore implements CredentialStore {
  constructor(private readonly runner: CommandRunner) {}

  async replace(credential: CredentialPayload): Promise<void> {
    const secret = Buffer.from(JSON.stringify(validateCredential(credential)), "utf8");
    try {
      const result = await this.runner.run(
        "secret-tool",
        ["store", "--label=UniPaper KHU credential", ...ATTRIBUTES],
        secret,
      );
      if (result.exitCode !== 0) {
        throw new HelperError("secret_service_unavailable");
      }
    } finally {
      secret.fill(0);
    }
  }

  async status(): Promise<CredentialStatus> {
    const result = await this.runner.run("secret-tool", ["lookup", ...ATTRIBUTES]);
    const configured = result.exitCode === 0 && result.stdout.length > 0;
    result.stdout.fill(0);
    return { configured, backend: BACKEND };
  }

  async load(): Promise<CredentialPayload> {
    const result = await this.runner.run("secret-tool", ["lookup", ...ATTRIBUTES]);
    if (result.exitCode !== 0 || result.stdout.length === 0) {
      result.stdout.fill(0);
      throw new HelperError("not_configured");
    }
    try {
      return validateCredential(JSON.parse(result.stdout.toString("utf8")));
    } catch (error) {
      if (error instanceof HelperError) throw error;
      throw new HelperError("secret_service_unavailable");
    } finally {
      result.stdout.fill(0);
    }
  }

  async remove(): Promise<void> {
    const result = await this.runner.run("secret-tool", ["clear", ...ATTRIBUTES]);
    if (result.exitCode !== 0) {
      throw new HelperError("secret_service_unavailable");
    }
  }
}

export const linuxVaultInternals = { attributes: ATTRIBUTES };
