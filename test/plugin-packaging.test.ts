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

  it("automatically persists only material research papers to Zotero", async () => {
    const skill = await repositoryFile("skills/institutional-paper-reader/SKILL.md");

    expect(skill).toContain("`save_research_paper_to_zotero`");
    expect(skill).toMatch(/materially supports/i);
    expect(skill).toMatch(/Do not save every search result/i);
    expect(skill).toMatch(/DOI-first/i);
  });
});
