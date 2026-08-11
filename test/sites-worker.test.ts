import { describe, expect, it } from "vitest";
// The deployed Worker is plain ESM so the exact production source can be tested.
// @ts-expect-error The deployment file intentionally has no TypeScript declarations.
import worker from "../deploy/sites-worker.js";

async function call(body: Record<string, unknown>) {
  const response = await worker.fetch(
    new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    {},
    {},
  );
  return { response, body: await response.json() };
}

describe("deployed Sites Worker", () => {
  it("initializes and advertises the four public tools", async () => {
    const initialized = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {} },
    });
    expect(initialized.response.status).toBe(200);
    expect(initialized.body.result.serverInfo.name).toBe("unipaper-bridge");

    const listed = await call({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(listed.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "resolve_paper",
      "find_open_access",
      "list_institutions",
      "build_institution_link",
    ]);
  });

  it("builds browser-only KHU links and rejects literal IP targets", async () => {
    const link = await call({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "build_institution_link",
        arguments: {
          institution_id: "khu-seoul",
          target_url: "https://doi.org/10.1000/test",
        },
      },
    });
    expect(link.body.result.structuredContent.credentials_handled_by_server).toBe(false);
    expect(link.body.result.structuredContent.access_url).toMatch(
      /^https:\/\/openlink\.khu\.ac\.kr\//,
    );

    const blocked = await call({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "build_institution_link",
        arguments: {
          institution_id: "khu-seoul",
          target_url: "http://127.0.0.1/private",
        },
      },
    });
    expect(blocked.body.result.isError).toBe(true);
  });
});
