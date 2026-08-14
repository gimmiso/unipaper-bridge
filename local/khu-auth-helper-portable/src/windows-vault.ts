import {
  HelperError,
  type CredentialPayload,
  type CredentialStatus,
  type CredentialStore,
  validateCredential,
} from "./models.js";
import type { CommandRunner } from "./command-runner.js";

const BACKEND = "windows-dpapi" as const;

function encodedPowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function powerShellArgs(script: string): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodedPowerShell(script),
  ];
}

const prelude = String.raw`
$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:LOCALAPPDATA 'UniPaper'
$path = Join-Path $directory 'khu-credential.dpapi'
$entropy = [Text.Encoding]::UTF8.GetBytes('com.gimmiso.unipaper.khu.v1')
`;

const storeScript = `${prelude}
[void][IO.Directory]::CreateDirectory($directory)
$plain = [Console]::In.ReadToEnd()
$plainBytes = [Text.Encoding]::UTF8.GetBytes($plain)
try {
  $protected = [Security.Cryptography.ProtectedData]::Protect(
    $plainBytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [IO.File]::WriteAllBytes($path, $protected)
} finally {
  if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
}
`;

const loadScript = `${prelude}
if (-not [IO.File]::Exists($path)) { exit 44 }
$protected = [IO.File]::ReadAllBytes($path)
$plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $protected,
  $entropy,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
try {
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write($plainBytes, 0, $plainBytes.Length)
} finally {
  if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
}
`;

const statusScript = `${prelude}
if ([IO.File]::Exists($path)) { exit 0 } else { exit 44 }
`;

const removeScript = `${prelude}
if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) }
`;

export class WindowsDPAPIStore implements CredentialStore {
  constructor(private readonly runner: CommandRunner) {}

  async replace(credential: CredentialPayload): Promise<void> {
    const secret = Buffer.from(JSON.stringify(validateCredential(credential)), "utf8");
    try {
      const result = await this.runner.run(
        "powershell.exe",
        powerShellArgs(storeScript),
        secret,
      );
      if (result.exitCode !== 0) throw new HelperError("vault_unavailable");
    } finally {
      secret.fill(0);
    }
  }

  async status(): Promise<CredentialStatus> {
    const result = await this.runner.run(
      "powershell.exe",
      powerShellArgs(statusScript),
    );
    if (result.exitCode !== 0 && result.exitCode !== 44) {
      throw new HelperError("vault_unavailable");
    }
    return { configured: result.exitCode === 0, backend: BACKEND };
  }

  async load(): Promise<CredentialPayload> {
    const result = await this.runner.run("powershell.exe", powerShellArgs(loadScript));
    if (result.exitCode === 44) throw new HelperError("not_configured");
    if (result.exitCode !== 0) throw new HelperError("vault_unavailable");
    try {
      return validateCredential(JSON.parse(result.stdout.toString("utf8")));
    } catch (error) {
      if (error instanceof HelperError) throw error;
      throw new HelperError("vault_unavailable");
    } finally {
      result.stdout.fill(0);
    }
  }

  async remove(): Promise<void> {
    const result = await this.runner.run(
      "powershell.exe",
      powerShellArgs(removeScript),
    );
    if (result.exitCode !== 0) throw new HelperError("vault_unavailable");
  }
}

export const windowsVaultInternals = {
  powerShellArgs,
  storeScript,
  loadScript,
};
