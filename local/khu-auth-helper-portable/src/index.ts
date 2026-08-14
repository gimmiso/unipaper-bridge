#!/usr/bin/env node
import { runCLI } from "./cli.js";

// Playwright debug logging can include action arguments. Disable it before the
// browser module is loaded so credential fills cannot be echoed by diagnostics.
delete process.env.DEBUG;
delete process.env.PWDEBUG;

const exitCode = await runCLI(process.argv.slice(2));
process.exitCode = exitCode;
