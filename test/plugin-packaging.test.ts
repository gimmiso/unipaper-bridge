import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function repositoryFile(path: string): Promise<string> {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("complete local plugin packaging", () => {
  it("bundles the public bridge and local KHU opener in one plugin", async () => {
    const configuration = JSON.parse(await repositoryFile(".mcp.json")) as Record<
      string,
      { command: string; args: string[] }
    >;

    expect(Object.keys(configuration)).toEqual([
      "unipaper-bridge",
      "unipaper-khu-local",
      "unipaper-zotero-local",
    ]);
    expect(configuration["unipaper-khu-local"]).toEqual({
      command: "node",
      args: ["${PLUGIN_ROOT}/local/khu-auth-mcp/dist/index.js"],
    });
    expect(configuration["unipaper-zotero-local"]).toEqual({
      command: "node",
      args: ["${PLUGIN_ROOT}/local/zotero-mcp/dist/index.js"],
    });
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
