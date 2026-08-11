import { describe, expect, it } from "vitest";
import { buildInstitutionLink, listInstitutions } from "../src/institutions.js";

describe("institution adapters", () => {
  it("lists both KHU campuses without credential handling", () => {
    const institutions = listInstitutions();
    expect(institutions.map((item) => item.id)).toEqual(["khu-seoul", "khu-global"]);
    expect(institutions.every((item) => item.credentials_handled_by_server === false)).toBe(
      true,
    );
  });

  it("builds the official KHU Seoul prefix", () => {
    const result = buildInstitutionLink(
      "khu-seoul",
      "https://www.nature.com/articles/s41586-024-00000-0",
    );
    expect(result.access_url).toBe(
      "https://openlink.khu.ac.kr/link.n2s?url=https://www.nature.com/articles/s41586-024-00000-0",
    );
    expect(result.authentication).toBe("user_browser");
  });

  it.each([
    "http://127.0.0.1/admin",
    "http://localhost/admin",
    "https://alice:secret@example.org/paper",
    "https://openlink.khu.ac.kr/link.n2s?url=https://example.org/paper",
  ])("rejects unsafe target %s", (target) => {
    expect(() => buildInstitutionLink("khu-seoul", target)).toThrow();
  });

  it("rejects unknown adapters", () => {
    expect(() => buildInstitutionLink("unknown", "https://nature.com/paper")).toThrow(
      /unknown institution adapter/i,
    );
  });
});
