import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import {
  ZoteroLocalClient,
  type SavePaperInput,
  type SavePaperResult,
  type ZoteroStatus,
} from "./zotero-client.js";
import { ZoteroAutoSavePreference } from "./config.js";

export interface ZoteroPaperStore {
  status(): Promise<ZoteroStatus>;
  savePaper(input: SavePaperInput): Promise<SavePaperResult>;
}

export interface AutoSavePreference {
  enabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
}

const authorSchema = z
  .object({
    first_name: z.string().max(200).optional(),
    last_name: z.string().max(200).optional(),
    name: z.string().max(300).optional(),
  })
  .refine((author) => Boolean(author.name || author.first_name || author.last_name));

const saveInputSchema = z
  .object({
    title: z.string().min(1).max(1_000),
    doi: z.string().max(300).optional(),
    authors: z.array(authorSchema).max(200).optional(),
    year: z.number().int().min(1000).max(3000).optional(),
    publication_title: z.string().max(500).optional(),
    volume: z.string().max(100).optional(),
    issue: z.string().max(100).optional(),
    pages: z.string().max(100).optional(),
    abstract: z.string().max(50_000).optional(),
    canonical_url: z.string().url().max(4_096).optional(),
    language: z.string().max(100).optional(),
    tags: z.array(z.string().min(1).max(100)).max(30).optional(),
    attachment_mode: z
      .enum(["oa", "metadata-only", "user-pdf", "licensed-pdf"])
      .describe(
        "Use oa only for verified lawful open access; user-pdf for an individual PDF supplied by the user; licensed-pdf for one individually requested PDF obtained locally through the user's own institutional entitlement.",
      ),
    local_pdf_path: z.string().max(4_096).optional(),
  })
  .superRefine((value, context) => {
    if (["user-pdf", "licensed-pdf"].includes(value.attachment_mode) && !value.local_pdf_path) {
      context.addIssue({
        code: "custom",
        message: "local_pdf_path is required for local PDF attachment modes",
        path: ["local_pdf_path"],
      });
    }
    if (!["user-pdf", "licensed-pdf"].includes(value.attachment_mode) && value.local_pdf_path) {
      context.addIssue({
        code: "custom",
        message: "local_pdf_path is allowed only in user-pdf or licensed-pdf mode",
        path: ["local_pdf_path"],
      });
    }
  });

const saveOutputSchema = z.object({
  status: z.enum(["already_exists", "saved_with_fulltext", "saved_metadata_only"]),
  item_key: z.string().optional(),
  duplicate: z.boolean(),
  fulltext_attached: z.boolean(),
  attachment_status: z.enum(["present", "saved", "not-requested", "unavailable"]),
  destination: z.string().optional(),
});

function safeErrorResult() {
  return {
    isError: true as const,
    structuredContent: {
      status: "error" as const,
      code: "zotero_unavailable" as const,
    },
    content: [
      {
        type: "text" as const,
        text: "Zotero Desktop could not complete the save. Open Zotero, confirm that the selected library is editable, and retry.",
      },
    ],
  };
}

export function createZoteroLocalServer(
  store: ZoteroPaperStore = new ZoteroLocalClient(),
  preference: AutoSavePreference = new ZoteroAutoSavePreference(),
): McpServer {
  const server = new McpServer(
    { name: "unipaper-zotero-local", version: "0.2.0" },
    {
      instructions:
        "Deduplicate and save research papers to the user's local Zotero Desktop library. Automatic saves require persisted opt-in or an explicit current request. Save only material papers. OA mode is only for verified open access. User-pdf is for a user-supplied individual file; licensed-pdf is for one file obtained locally through the user's own entitlement. Never store credentials, cookies, proxy URLs, or browser sessions.",
    },
  );

  server.registerTool(
    "zotero_research_status",
    {
      title: "Check local Zotero research storage",
      description:
        "Checks whether Zotero Desktop and its local connector are ready and reports the currently selected save destination.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        ready: z.boolean(),
        auto_save_enabled: z.boolean(),
        api_running: z.boolean(),
        connector_running: z.boolean(),
        destination: z.string().optional(),
        files_editable: z.boolean().optional(),
        zotero_version: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const result = {
          ...(await store.status()),
          auto_save_enabled: await preference.enabled(),
        };
        return {
          structuredContent: result,
          content: [
            {
              type: "text" as const,
              text: result.ready
                ? `Zotero is ready. New research papers will be saved to ${result.destination ?? "the selected library"}.`
                : "Zotero Desktop is not ready for local saves.",
            },
          ],
        };
      } catch {
        return safeErrorResult();
      }
    },
  );

  server.registerTool(
    "configure_zotero_autosave",
    {
      title: "Configure automatic Zotero research saves",
      description:
        "Persists the user's opt-in or opt-out for automatically saving only important papers that materially support future research answers. Call only when the user explicitly asks to enable or disable this behavior.",
      inputSchema: z.object({ enabled: z.boolean() }),
      outputSchema: z.object({
        status: z.literal("configured"),
        auto_save_enabled: z.boolean(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ enabled }) => {
      try {
        await preference.setEnabled(enabled);
        const result = { status: "configured" as const, auto_save_enabled: enabled };
        return {
          structuredContent: result,
          content: [
            {
              type: "text" as const,
              text: enabled
                ? "Automatic Zotero capture is enabled for important research papers."
                : "Automatic Zotero capture is disabled.",
            },
          ],
        };
      } catch {
        return safeErrorResult();
      }
    },
  );

  server.registerTool(
    "save_research_paper_to_zotero",
    {
      title: "Save a key research paper to Zotero",
      description:
        "DOI-first deduplicated save for a paper that materially supports the current answer. Use only when automatic saves are enabled or the user explicitly requested this save. Use oa only after verifying lawful open access. Use user-pdf only when the user lawfully supplied or selected that individual PDF. Metadata-only is allowed for an unresolved but decisive paper. Do not use for search-result dumps, whole reference lists, issues, or books.",
      inputSchema: saveInputSchema,
      outputSchema: saveOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const result = await store.savePaper(input);
        return {
          structuredContent: { ...result },
          content: [
            {
              type: "text" as const,
              text:
                result.status === "already_exists"
                  ? "The paper is already in Zotero; no duplicate was created."
                  : result.fulltext_attached
                    ? "The verified paper metadata and full text were saved to Zotero."
                    : "The verified paper metadata was saved to Zotero, but no full-text PDF was attached.",
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
