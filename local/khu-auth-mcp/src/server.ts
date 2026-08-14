import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { buildKHUAccessURL, type KHUInstitutionId } from "./access-url.js";
import { ManagedPaperStore } from "./paper-store.js";

export interface KHUHelperLauncher {
  launch(accessURL: string): Promise<void>;
  fetch(accessURL: string, destination: string): Promise<void>;
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
      await new Promise<void>((resolveClean, rejectClean) => {
        const cleaner = spawn("/usr/bin/xattr", ["-cr", this.appPath], {
          stdio: "ignore",
        });
        cleaner.once("error", () => rejectClean(new Error("browser_launch_failed")));
        cleaner.once("close", (code) => {
          if (code === 0) resolveClean();
          else rejectClean(new Error("browser_launch_failed"));
        });
      });
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

  async fetch(accessURL: string, destination: string): Promise<void> {
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
      command = executable;
      args = ["fetch", accessURL, destination];
    } else {
      await access(this.portableEntry, constants.R_OK);
      command = process.execPath;
      args = [this.portableEntry, "fetch", accessURL, destination];
    }

    await new Promise<void>((resolveRun, rejectRun) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      let output = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) rejectRun(error);
        else resolveRun();
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error("download_timeout"));
      }, 10 * 60 * 1_000);

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        if (output.length + chunk.length > 64 * 1_024) {
          child.kill();
          finish(new Error("helper_output_too_large"));
          return;
        }
        output += chunk;
      });
      child.once("error", () => finish(new Error("browser_launch_failed")));
      child.once("close", (code) => {
        if (code !== 0) {
          finish(new Error("download_failed"));
          return;
        }
        try {
          const line = output
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
            .at(-1);
          const parsed = line ? (JSON.parse(line) as Record<string, unknown>) : undefined;
          if (
            parsed?.status !== "downloaded" ||
            parsed.credential_exposed !== false
          ) {
            finish(new Error("download_failed"));
            return;
          }
          finish();
        } catch {
          finish(new Error("download_failed"));
        }
      });
    });
  }
}

function safeErrorResult(message = "The local KHU helper could not complete the request. Run the local setup command on this computer and try again.") {
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
        text: message,
      },
    ],
  };
}

function normalizedDoi(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

export function createKHULocalServer(
  launcher: KHUHelperLauncher = new PlatformKHUHelperLauncher(),
  paperStore = new ManagedPaperStore(),
): McpServer {
  type FetchJob =
    | { status: "fetching"; cleanupTimer: NodeJS.Timeout }
    | {
        status: "downloaded";
        cleanupTimer: NodeJS.Timeout;
        localPdfPath: string;
        sizeBytes: number;
        sha256: string;
        identityStatus: "matched" | "unconfirmed";
      }
    | { status: "error"; cleanupTimer: NodeJS.Timeout };
  const fetchJobs = new Map<string, FetchJob>();

  const server = new McpServer(
    { name: "unipaper-khu-local", version: "0.2.0" },
    {
      instructions:
        "Fetch at most one user-selected paper per call through the local KHU browser helper, read bounded page text locally, and release the temporary copy after analysis or Zotero attachment. Never request or return university credentials, MFA codes, cookies, session values, or licensed PDF bytes. The helper retrieves credentials only inside the user's computer.",
    },
  );

  server.registerTool(
    "fetch_khu_paper",
    {
      title: "Download one paper with KHU access on this computer",
      description:
        "Starts the isolated local KHU browser for exactly one user-selected PDF and immediately returns a managed download_id. Poll check_khu_paper_fetch until validation finishes. Credentials and browser sessions never leave the helper.",
      inputSchema: z.object({
        institution_id: z.enum(["khu-seoul", "khu-global"]),
        target_url: z
          .string()
          .min(1)
          .max(4_096)
          .describe("The canonical public publisher, DOI, or repository URL for one paper."),
        expected_doi: z
          .string()
          .trim()
          .min(6)
          .max(255)
          .optional()
          .describe("The DOI already verified by the scholarly-search stage."),
      }),
      outputSchema: z.object({
        status: z.literal("fetching"),
        download_id: z.string(),
        credential_exposed: z.literal(false),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ institution_id, target_url, expected_doi }) => {
      try {
        for (const [existingId, job] of fetchJobs) {
          if (job.status === "error") {
            clearTimeout(job.cleanupTimer);
            fetchJobs.delete(existingId);
          }
        }
        if (fetchJobs.size > 0) {
          return safeErrorResult(
            "Finish and release the current one-paper KHU job before starting another.",
          );
        }
        const accessURL = buildKHUAccessURL(
          institution_id as KHUInstitutionId,
          target_url,
        );
        const allocation = await paperStore.allocate();
        const cleanupTimer = setTimeout(() => {
          void paperStore.release(allocation.downloadId).catch(() => undefined);
          fetchJobs.delete(allocation.downloadId);
        }, 30 * 60 * 1_000);
        cleanupTimer.unref();
        fetchJobs.set(allocation.downloadId, { status: "fetching", cleanupTimer });

        void (async () => {
          try {
            await launcher.fetch(accessURL, allocation.pdfPath);
            const paper = await paperStore.verify(allocation.downloadId);
            let identityStatus: "matched" | "unconfirmed" = "unconfirmed";
            const expected = normalizedDoi(expected_doi);
            if (expected) {
              const identityPages = await paperStore
                .readPages(allocation.downloadId, 1, 3)
                .catch(() => undefined);
              const identityText = identityPages?.pages
                .map((page) => page.text.toLowerCase().replace(/\s+/g, ""))
                .join("");
              if (identityText?.includes(expected.replace(/\s+/g, ""))) {
                identityStatus = "matched";
              }
            }
            fetchJobs.set(allocation.downloadId, {
              status: "downloaded",
              cleanupTimer,
              localPdfPath: paper.pdfPath,
              sizeBytes: paper.sizeBytes,
              sha256: paper.sha256,
              identityStatus,
            });
          } catch {
            await paperStore.release(allocation.downloadId).catch(() => undefined);
            fetchJobs.set(allocation.downloadId, { status: "error", cleanupTimer });
          }
        })();

        const result = {
          status: "fetching" as const,
          download_id: allocation.downloadId,
          credential_exposed: false as const,
        };
        return {
          structuredContent: result,
          content: [
            {
              type: "text" as const,
              text: "The isolated local browser started a one-paper fetch. Poll check_khu_paper_fetch with this download_id until it reports downloaded.",
            },
          ],
        };
      } catch {
        return safeErrorResult(
          "The helper could not start this one-paper request.",
        );
      }
    },
  );

  server.registerTool(
    "check_khu_paper_fetch",
    {
      title: "Check a one-paper KHU download",
      description:
        "Polls a managed one-paper fetch without extending a single MCP call across interactive browser time. Returns the local PDF reference only after signature, size, hash, and optional DOI-text checks finish.",
      inputSchema: z.object({ download_id: z.string().uuid() }),
      outputSchema: z.object({
        status: z.enum(["fetching", "downloaded"]),
        download_id: z.string(),
        local_pdf_path: z.string().optional(),
        size_bytes: z.number().int().positive().optional(),
        sha256: z.string().optional(),
        identity_status: z.enum(["matched", "unconfirmed"]).optional(),
        credential_exposed: z.literal(false),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ download_id }) => {
      const job = fetchJobs.get(download_id);
      if (!job || job.status === "error") {
        if (job) {
          clearTimeout(job.cleanupTimer);
          fetchJobs.delete(download_id);
        }
        return safeErrorResult(
          "The helper could not obtain a valid PDF. Complete any required publisher action in the isolated browser, confirm subscription coverage, then retry.",
        );
      }
      if (job.status === "fetching") {
        const result = {
          status: "fetching" as const,
          download_id,
          credential_exposed: false as const,
        };
        return {
          structuredContent: result,
          content: [
            {
              type: "text" as const,
              text: "The isolated browser is still obtaining this one paper. Poll again shortly.",
            },
          ],
        };
      }
      const result = {
        status: "downloaded" as const,
        download_id,
        local_pdf_path: job.localPdfPath,
        size_bytes: job.sizeBytes,
        sha256: job.sha256,
        identity_status: job.identityStatus,
        credential_exposed: false as const,
      };
      return {
        structuredContent: result,
        content: [
          {
            type: "text" as const,
            text: "One PDF was downloaded and validated locally. Read it by download_id, optionally attach the managed path to Zotero, then release it.",
          },
        ],
      };
    },
  );

  server.registerTool(
    "read_khu_paper_pages",
    {
      title: "Read pages from a downloaded KHU paper",
      description:
        "Extracts text from a bounded page range of one PDF held in the managed local temporary store. It never returns credentials, cookies, or raw PDF bytes.",
      inputSchema: z.object({
        download_id: z.string().uuid(),
        start_page: z.number().int().min(1).default(1),
        page_count: z.number().int().min(1).max(10).default(3),
      }),
      outputSchema: z.object({
        status: z.literal("read"),
        total_pages: z.number().int().positive(),
        pages: z.array(
          z.object({
            page_number: z.number().int().positive(),
            text: z.string(),
            truncated: z.boolean(),
          }),
        ),
        credential_exposed: z.literal(false),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ download_id, start_page, page_count }) => {
      try {
        const extracted = await paperStore.readPages(
          download_id,
          start_page,
          page_count,
        );
        const result = {
          status: "read" as const,
          total_pages: extracted.totalPages,
          pages: extracted.pages.map((page) => ({
            page_number: page.pageNumber,
            text: page.text,
            truncated: page.truncated,
          })),
          credential_exposed: false as const,
        };
        return {
          structuredContent: result,
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch {
        return safeErrorResult("The managed PDF or requested page range is unavailable.");
      }
    },
  );

  server.registerTool(
    "release_khu_paper",
    {
      title: "Delete a managed temporary KHU paper",
      description:
        "Deletes only the managed temporary directory identified by download_id. It cannot delete an arbitrary user path or a Zotero attachment.",
      inputSchema: z.object({ download_id: z.string().uuid() }),
      outputSchema: z.object({
        status: z.literal("released"),
        credential_exposed: z.literal(false),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ download_id }) => {
      const job = fetchJobs.get(download_id);
      if (job?.status === "fetching") {
        return safeErrorResult(
          "This paper is still downloading. Check its status before releasing it.",
        );
      }
      const released = await paperStore.release(download_id).catch(() => false);
      if (!released) {
        return safeErrorResult("The managed temporary paper was already released or is unavailable.");
      }
      if (job) clearTimeout(job.cleanupTimer);
      fetchJobs.delete(download_id);
      const result = {
        status: "released" as const,
        credential_exposed: false as const,
      };
      return {
        structuredContent: result,
        content: [{ type: "text" as const, text: "The managed temporary PDF was deleted." }],
      };
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
