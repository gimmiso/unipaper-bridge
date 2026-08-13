import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { buildKHUAccessURL, type KHUInstitutionId } from "./access-url.js";

export interface KHUHelperLauncher {
  launch(accessURL: string): Promise<void>;
}

function localDirectory(): string {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const localMcpDirectory = resolve(sourceDirectory, "..");
  return resolve(localMcpDirectory, "..");
}

function defaultAppPath(): string {
  return resolve(
    localDirectory(),
    "khu-auth-helper",
    "build",
    "UniPaper KHU Helper.app",
  );
}

function defaultPortableEntry(): string {
  return resolve(localDirectory(), "khu-auth-helper-portable", "dist", "index.js");
}

export class PlatformKHUHelperLauncher implements KHUHelperLauncher {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly appPath = defaultAppPath(),
    private readonly portableEntry = defaultPortableEntry(),
  ) {}

  async launch(accessURL: string): Promise<void> {
    if (!["darwin", "win32", "linux"].includes(this.platform)) {
      throw new Error("unsupported_platform");
    }

    let command: string;
    let args: string[];
    if (this.platform === "darwin") {
      const executable = resolve(
        this.appPath,
        "Contents",
        "MacOS",
        "khu-keychain-helper",
      );
      await access(executable, constants.X_OK);
      command = "/usr/bin/open";
      args = ["-n", this.appPath, "--args", "open", accessURL];
    } else {
      await access(this.portableEntry, constants.R_OK);
      command = process.execPath;
      args = [this.portableEntry, "open", accessURL];
    }

    await new Promise<void>((resolveLaunch, rejectLaunch) => {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("spawn", () => {
        child.unref();
        resolveLaunch();
      });
      child.once("error", () => rejectLaunch(new Error("browser_launch_failed")));
    });
  }
}

function safeErrorResult() {
  return {
    isError: true as const,
    structuredContent: {
      status: "error" as const,
      code: "local_helper_unavailable" as const,
      credential_exposed: false as const,
    },
    content: [
      {
        type: "text" as const,
        text: "The local KHU helper could not be opened. Run the local setup command on this computer and try again.",
      },
    ],
  };
}

export function createKHULocalServer(
  launcher: KHUHelperLauncher = new PlatformKHUHelperLauncher(),
): McpServer {
  const server = new McpServer(
    { name: "unipaper-khu-local", version: "0.1.0" },
    {
      instructions:
        "Open one user-selected paper through the local KHU browser helper. Never request or return university credentials, MFA codes, cookies, or sessions. The helper retrieves credentials only inside the user's computer and returns no credential fields.",
    },
  );

  server.registerTool(
    "open_khu_paper",
    {
      title: "Open a paper with KHU access on this computer",
      description:
        "Opens one public paper URL in the local KHU helper. OS-vault credentials, if needed, are consumed only by the isolated helper and are never returned to this MCP server or the model.",
      inputSchema: z.object({
        institution_id: z.enum(["khu-seoul", "khu-global"]),
        target_url: z
          .string()
          .min(1)
          .max(4_096)
          .describe("The canonical public publisher, DOI, or repository URL."),
      }),
      outputSchema: z.object({
        status: z.literal("browser_opened"),
        credential_exposed: z.literal(false),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ institution_id, target_url }) => {
      try {
        const accessURL = buildKHUAccessURL(
          institution_id as KHUInstitutionId,
          target_url,
        );
        await launcher.launch(accessURL);
        const result = {
          status: "browser_opened" as const,
          credential_exposed: false as const,
        };
        return {
          structuredContent: result,
          content: [
            {
              type: "text" as const,
              text: "The local KHU browser opened. It will reuse its existing session or request operating-system vault access locally if sign-in is required.",
            },
          ],
        };
      } catch {
        return safeErrorResult();
      }
    },
  );

  return server;
}
