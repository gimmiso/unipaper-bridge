import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function repositoryFile(path: string): Promise<string> {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("complete local plugin packaging", () => {
  it("bundles the public bridge and all local research MCPs in one plugin", async () => {
    const configuration = JSON.parse(await repositoryFile(".mcp.json")) as Record<
      string,
      { command: string; args: string[] }
    >;

    expect(Object.keys(configuration)).toEqual([
      "unipaper-bridge",
      "unipaper-khu-local",
      "unipaper-zotero-local",
      "unipaper-draft-audit-local",
    ]);
    expect(configuration["unipaper-khu-local"]).toEqual({
      command: "node",
      args: ["${PLUGIN_ROOT}/local/khu-auth-mcp/dist/index.js"],
    });
    expect(configuration["unipaper-zotero-local"]).toEqual({
      command: "node",
      args: ["${PLUGIN_ROOT}/local/zotero-mcp/dist/index.js"],
    });
    expect(configuration["unipaper-draft-audit-local"]).toEqual({
      command: "node",
      args: ["${PLUGIN_ROOT}/local/draft-audit-mcp/dist/index.js"],
    });
  });

  it("audits unpublished draft claims only through the local read-only MCP", async () => {
    const skill = await repositoryFile("skills/draft-claim-auditor/SKILL.md");
    const metadata = await repositoryFile("skills/draft-claim-auditor/agents/openai.yaml");
    const localServer = await repositoryFile("local/draft-audit-mcp/src/server.ts");
    const localAudit = await repositoryFile("local/draft-audit-mcp/src/audit.ts");
    const localEntry = await repositoryFile("local/draft-audit-mcp/src/index.ts");
    const worker = await repositoryFile("deploy/sites-worker.js");

    expect(skill).toContain("`audit_draft_claims`");
    expect(skill).toMatch(/Never send the full unpublished draft to a hosted/i);
    expect(skill).toMatch(/does not read papers/i);
    expect(skill).toMatch(/UTF-16/);
    expect(metadata).toContain("allow_implicit_invocation: true");
    expect(localServer).toContain('"audit_draft_claims"');
    expect(localServer).toMatch(/readOnlyHint: true/);
    expect(localServer).toMatch(/openWorldHint: false/);
    for (const implementation of [localServer, localAudit, localEntry]) {
      expect(implementation).not.toMatch(/(?:node:fs|node:http|node:https|fetch\s*\()/);
    }
    expect(worker).not.toContain('name: "audit_draft_claims"');
  });

  it("makes KHU an implicit full-text fallback rather than a user-selected step", async () => {
    const skill = await repositoryFile("skills/institutional-paper-reader/SKILL.md");
    const metadata = await repositoryFile(
      "skills/institutional-paper-reader/agents/openai.yaml",
    );

    expect(skill).toMatch(/invoke the local\s+institutional fallback automatically/);
    expect(skill).toContain("`open_khu_paper`");
    expect(skill).toMatch(/call it\s+automatically/);
    expect(skill).toMatch(/does\s+not prove that Codex read the paper/);
    expect(metadata).toContain("allow_implicit_invocation: true");
  });

  it("expands citation networks automatically but keeps the search bounded", async () => {
    const reader = await repositoryFile("skills/institutional-paper-reader/SKILL.md");
    const novelty = await repositoryFile("skills/academic-novelty-auditor/SKILL.md");

    expect(reader).toContain("`expand_citation_network`");
    expect(reader).toMatch(/one-hop expansion/i);
    expect(reader).toContain("`per_relation: 5`");
    expect(reader).toMatch(/Never infer.*supports, disputes, or replicates/is);
    expect(novelty).toContain("`expand_citation_network`");
    expect(novelty).toMatch(/not proof of support or\s+contradiction/i);
  });

  it("automatically persists only material research papers to Zotero", async () => {
    const skill = await repositoryFile("skills/institutional-paper-reader/SKILL.md");

    expect(skill).toContain("`save_research_paper_to_zotero`");
    expect(skill).toMatch(/materially supports/i);
    expect(skill).toMatch(/Do not save every search result/i);
    expect(skill).toMatch(/DOI-first/i);
  });

  it("builds a checked evidence matrix before multi-paper synthesis and Zotero", async () => {
    const reader = await repositoryFile("skills/institutional-paper-reader/SKILL.md");
    const novelty = await repositoryFile("skills/academic-novelty-auditor/SKILL.md");

    expect(reader).toContain("`build_evidence_matrix`");
    expect(reader).toMatch(/before cross-paper synthesis/i);
    expect(reader).toMatch(/only after synthesis/i);
    expect(reader).toMatch(/FULLTEXT-OA/);
    expect(reader).toMatch(/ready_for_synthesis/);
    expect(reader).toMatch(/does not read papers/i);
    expect(novelty).toContain("`build_evidence_matrix`");
    expect(novelty).toMatch(/before the verdict or Zotero/i);
  });
});
