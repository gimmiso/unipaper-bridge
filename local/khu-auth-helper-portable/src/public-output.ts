import { HelperError, type PublicErrorCode } from "./models.js";

export interface PublicResult {
  status: string;
  credential_exposed: false;
  backend?: "windows-dpapi" | "linux-secret-service";
  code?: PublicErrorCode;
}

export function successResult(
  status: string,
  backend?: PublicResult["backend"],
): PublicResult {
  return {
    status,
    credential_exposed: false,
    ...(backend ? { backend } : {}),
  };
}

export function failureResult(error: unknown): PublicResult {
  return {
    status: "error",
    credential_exposed: false,
    code: error instanceof HelperError ? error.publicCode : "vault_unavailable",
  };
}

export function encodedLine(result: PublicResult): string {
  return `${JSON.stringify(result)}\n`;
}
