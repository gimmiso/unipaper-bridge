import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: Buffer;
}

export interface CommandRunner {
  run(command: string, args: string[], input?: Buffer): Promise<CommandResult>;
}

const MAX_CAPTURE_BYTES = 8_192;

export class LocalCommandRunner implements CommandRunner {
  async run(command: string, args: string[], input?: Buffer): Promise<CommandResult> {
    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      });
      const chunks: Buffer[] = [];
      let capturedBytes = 0;

      child.stdout.on("data", (chunk: Buffer) => {
        if (capturedBytes >= MAX_CAPTURE_BYTES) return;
        const remaining = MAX_CAPTURE_BYTES - capturedBytes;
        const bounded = chunk.subarray(0, remaining);
        chunks.push(bounded);
        capturedBytes += bounded.length;
      });
      child.once("error", reject);
      child.once("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(chunks),
        });
      });

      if (input) {
        child.stdin.end(input);
      } else {
        child.stdin.end();
      }
    });
  }
}
