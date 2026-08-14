export type SupportedPlatform = "win32" | "linux";

export interface CredentialPayload {
  version: 1;
  account: string;
  password: string;
}

export interface CredentialStatus {
  configured: boolean;
  backend: "windows-dpapi" | "linux-secret-service";
}

export interface CredentialStore {
  replace(credential: CredentialPayload): Promise<void>;
  status(): Promise<CredentialStatus>;
  load(): Promise<CredentialPayload>;
  remove(): Promise<void>;
}

export type PublicErrorCode =
  | "authentication_cancelled"
  | "browser_not_installed"
  | "browser_launch_failed"
  | "download_failed"
  | "download_timeout"
  | "invalid_access_url"
  | "invalid_account"
  | "invalid_arguments"
  | "invalid_password"
  | "not_configured"
  | "password_mismatch"
  | "secret_service_unavailable"
  | "unsupported_platform"
  | "vault_unavailable";

export class HelperError extends Error {
  constructor(readonly publicCode: PublicErrorCode) {
    super(publicCode);
    this.name = "HelperError";
  }
}

export function validateCredential(value: unknown): CredentialPayload {
  if (!value || typeof value !== "object") {
    throw new HelperError("vault_unavailable");
  }
  const candidate = value as Partial<CredentialPayload>;
  if (
    candidate.version !== 1 ||
    typeof candidate.account !== "string" ||
    candidate.account.length === 0 ||
    candidate.account.length > 128 ||
    typeof candidate.password !== "string" ||
    candidate.password.length === 0 ||
    Buffer.byteLength(candidate.password, "utf8") > 1_024
  ) {
    throw new HelperError("vault_unavailable");
  }
  return {
    version: 1,
    account: candidate.account,
    password: candidate.password,
  };
}
