import { stderr, stdout } from "node:process";
import { openKHUAccess, PlaywrightBrowserAdapter, type BrowserAdapter } from "./browser.js";
import { HelperError, type CredentialStore, type SupportedPlatform } from "./models.js";
import { encodedLine, failureResult, successResult } from "./public-output.js";
import { readAccount, readSecret } from "./secure-prompt.js";
import { createCredentialStore } from "./store.js";

export interface CLIDependencies {
  store: CredentialStore;
  platform: SupportedPlatform;
  browser: BrowserAdapter;
  accountPrompt: () => Promise<string>;
  secretPrompt: (prompt: string) => Promise<string>;
  writeOutput: (value: string) => void;
}

function defaultDependencies(): CLIDependencies {
  const { store, platform } = createCredentialStore();
  return {
    store,
    platform,
    browser: new PlaywrightBrowserAdapter(),
    accountPrompt: () => readAccount(),
    secretPrompt: readSecret,
    writeOutput: (value) => stdout.write(value),
  };
}

export async function runCLI(
  args: string[],
  injectedDependencies?: CLIDependencies,
): Promise<number> {
  const writeOutput =
    injectedDependencies?.writeOutput ?? ((value: string) => stdout.write(value));
  try {
    const dependencies = injectedDependencies ?? defaultDependencies();
    const [command, ...rest] = args;
    if (!command) throw new HelperError("invalid_arguments");

    switch (command) {
      case "setup": {
        if (rest.length !== 0) throw new HelperError("invalid_arguments");
        const account = await dependencies.accountPrompt();
        let password = await dependencies.secretPrompt("KHU Password: ");
        let confirmation = await dependencies.secretPrompt("Confirm Password: ");
        try {
          if (password !== confirmation) throw new HelperError("password_mismatch");
          await dependencies.store.replace({ version: 1, account, password });
        } finally {
          password = "";
          confirmation = "";
        }
        const status = await dependencies.store.status();
        dependencies.writeOutput(encodedLine(successResult("stored", status.backend)));
        return 0;
      }
      case "status": {
        if (rest.length !== 0) throw new HelperError("invalid_arguments");
        const status = await dependencies.store.status();
        dependencies.writeOutput(
          encodedLine(
            successResult(
              status.configured ? "configured" : "not_configured",
              status.backend,
            ),
          ),
        );
        return 0;
      }
      case "remove": {
        if (rest.length !== 1 || rest[0] !== "--yes") {
          throw new HelperError("invalid_arguments");
        }
        await dependencies.store.remove();
        dependencies.writeOutput(encodedLine(successResult("removed")));
        return 0;
      }
      case "open": {
        if (rest.length !== 1) throw new HelperError("invalid_arguments");
        const result = await openKHUAccess(
          rest[0]!,
          dependencies.store,
          dependencies.browser,
          dependencies.platform,
        );
        dependencies.writeOutput(
          encodedLine(successResult(`browser_closed:${result.authentication}`)),
        );
        return 0;
      }
      case "help":
      case "--help":
      case "-h":
        stderr.write(
          [
            "khu-auth-helper setup",
            "khu-auth-helper status",
            "khu-auth-helper open <KHU access URL>",
            "khu-auth-helper remove --yes",
            "",
            "Credentials are accepted only from a no-echo local terminal prompt.",
          ].join("\n") + "\n",
        );
        return 0;
      default:
        throw new HelperError("invalid_arguments");
    }
  } catch (error) {
    writeOutput(encodedLine(failureResult(error)));
    return 1;
  }
}
