import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { HelperError } from "./models.js";

export async function readAccount(prompt = "KHU ID: "): Promise<string> {
  if (!stdin.isTTY) throw new HelperError("invalid_account");
  const reader = createInterface({ input: stdin, output: stderr });
  try {
    const account = (await reader.question(prompt)).trim();
    if (
      account.length === 0 ||
      account.length > 128 ||
      /[\u0000-\u001f\u007f]/u.test(account)
    ) {
      throw new HelperError("invalid_account");
    }
    return account;
  } finally {
    reader.close();
  }
}

export async function readSecret(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stderr.isTTY || !stdin.setRawMode) {
    throw new HelperError("invalid_password");
  }
  stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  let secret = "";
  try {
    for await (const chunk of stdin) {
      for (const character of String(chunk)) {
        if (character === "\u0003") throw new HelperError("authentication_cancelled");
        if (character === "\r" || character === "\n") {
          stderr.write("\n");
          if (secret.length === 0 || Buffer.byteLength(secret, "utf8") > 1_024) {
            throw new HelperError("invalid_password");
          }
          return secret;
        }
        if (character === "\u007f" || character === "\b") {
          secret = secret.slice(0, -1);
          continue;
        }
        if (character >= " ") secret += character;
        if (Buffer.byteLength(secret, "utf8") > 1_024) {
          throw new HelperError("invalid_password");
        }
      }
    }
    throw new HelperError("invalid_password");
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}
