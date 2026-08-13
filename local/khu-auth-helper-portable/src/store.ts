import type { CredentialStore, SupportedPlatform } from "./models.js";
import { HelperError } from "./models.js";
import { LocalCommandRunner, type CommandRunner } from "./command-runner.js";
import { LinuxSecretServiceStore } from "./linux-vault.js";
import { WindowsDPAPIStore } from "./windows-vault.js";

export function createCredentialStore(
  platform: NodeJS.Platform = process.platform,
  runner: CommandRunner = new LocalCommandRunner(),
): { store: CredentialStore; platform: SupportedPlatform } {
  if (platform === "win32") {
    return { store: new WindowsDPAPIStore(runner), platform };
  }
  if (platform === "linux") {
    return { store: new LinuxSecretServiceStore(runner), platform };
  }
  throw new HelperError("unsupported_platform");
}
