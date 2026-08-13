#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const localDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(localDirectory, "..");
const macHelperDirectory = join(localDirectory, "khu-auth-helper");
const macExecutable = join(
  macHelperDirectory,
  "build",
  "UniPaper KHU Helper.app",
  "Contents",
  "MacOS",
  "khu-keychain-helper",
);
const portableDirectory = join(localDirectory, "khu-auth-helper-portable");
const portableEntry = join(portableDirectory, "dist", "index.js");
const localMCPDirectory = join(localDirectory, "khu-auth-mcp");
const localMCPEntry = join(localMCPDirectory, "dist", "index.js");
const zoteroMCPDirectory = join(localDirectory, "zotero-mcp");
const zoteroMCPEntry = join(zoteroMCPDirectory, "dist", "index.js");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
    windowsHide: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function installAndBuild(packageDirectory) {
  run(npmCommand, ["ci", "--prefix", packageDirectory]);
  run(npmCommand, ["run", "build", "--prefix", packageDirectory]);
}

function buildAll() {
  installAndBuild(localMCPDirectory);
  installAndBuild(zoteroMCPDirectory);
  installAndBuild(portableDirectory);
  if (process.platform === "darwin") {
    run("sh", [join(macHelperDirectory, "install.sh"), "build"]);
  }
}

function ensureBuilt() {
  const expected = process.platform === "darwin" ? macExecutable : portableEntry;
  if (
    !existsSync(expected) ||
    !existsSync(localMCPEntry) ||
    !existsSync(zoteroMCPEntry)
  ) {
    buildAll();
  }
}

function installPortableBrowser() {
  const playwrightCLI = join(portableDirectory, "node_modules", "playwright", "cli.js");
  if (!existsSync(playwrightCLI)) installAndBuild(portableDirectory);
  run(process.execPath, [playwrightCLI, "install", "chromium"]);
}

function runPlatformHelper(action, args) {
  ensureBuilt();
  if (process.platform === "darwin") {
    run(macExecutable, [action, ...args]);
    return;
  }
  if (process.platform !== "win32" && process.platform !== "linux") {
    process.stderr.write("UniPaper KHU helper supports macOS, Windows, and Linux.\n");
    process.exit(1);
  }
  if (action === "setup") installPortableBrowser();
  run(process.execPath, [portableEntry, action, ...args]);
}

const [action = "build", ...args] = process.argv.slice(2);
switch (action) {
  case "build":
    buildAll();
    break;
  case "setup":
  case "status":
    runPlatformHelper(action, args);
    break;
  case "remove":
    runPlatformHelper("remove", ["--yes"]);
    break;
  case "test":
    installAndBuild(localMCPDirectory);
    installAndBuild(zoteroMCPDirectory);
    installAndBuild(portableDirectory);
    run(npmCommand, ["test", "--prefix", localMCPDirectory]);
    run(npmCommand, ["test", "--prefix", zoteroMCPDirectory]);
    run(npmCommand, ["test", "--prefix", portableDirectory]);
    if (process.platform === "darwin") {
      run("swift", ["run", "--package-path", macHelperDirectory, "khu-auth-self-test"]);
    }
    break;
  default:
    process.stderr.write("Usage: khu-helper.mjs [build|setup|status|remove|test]\n");
    process.exit(64);
}
