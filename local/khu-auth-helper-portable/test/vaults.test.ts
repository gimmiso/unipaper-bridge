import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "../src/command-runner.js";
import { LinuxSecretServiceStore } from "../src/linux-vault.js";
import { WindowsDPAPIStore } from "../src/windows-vault.js";

class RecordingRunner implements CommandRunner {
  calls: Array<{ command: string; args: string[]; input?: Buffer }> = [];

  constructor(private readonly result: CommandResult = { exitCode: 0, stdout: Buffer.alloc(0) }) {}

  async run(command: string, args: string[], input?: Buffer): Promise<CommandResult> {
    this.calls.push({
      command,
      args: [...args],
      ...(input ? { input: Buffer.from(input) } : {}),
    });
    return { exitCode: this.result.exitCode, stdout: Buffer.from(this.result.stdout) };
  }
}

const credential = {
  version: 1 as const,
  account: "2025999999",
  password: "never-put-this-in-args",
};

describe("platform vault process boundaries", () => {
  it("sends Windows DPAPI plaintext only through stdin", async () => {
    const runner = new RecordingRunner();
    const store = new WindowsDPAPIStore(runner);
    await store.replace(credential);

    const call = runner.calls[0]!;
    expect(call.command).toBe("powershell.exe");
    expect(call.args.join(" ")).not.toContain(credential.account);
    expect(call.args.join(" ")).not.toContain(credential.password);
    expect(call.input?.toString("utf8")).toContain(credential.password);
  });

  it("sends Linux Secret Service plaintext only through stdin", async () => {
    const runner = new RecordingRunner();
    const store = new LinuxSecretServiceStore(runner);
    await store.replace(credential);

    const call = runner.calls[0]!;
    expect(call.command).toBe("secret-tool");
    expect(call.args.join(" ")).not.toContain(credential.account);
    expect(call.args.join(" ")).not.toContain(credential.password);
    expect(call.input?.toString("utf8")).toContain(credential.password);
  });

  it("loads and validates a DPAPI payload without logging it", async () => {
    const runner = new RecordingRunner({
      exitCode: 0,
      stdout: Buffer.from(JSON.stringify(credential), "utf8"),
    });
    const store = new WindowsDPAPIStore(runner);
    await expect(store.load()).resolves.toEqual(credential);
    expect(runner.calls[0]!.args.join(" ")).not.toContain(credential.password);
  });
});
