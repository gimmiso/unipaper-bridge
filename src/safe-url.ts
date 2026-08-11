import { isIP } from "node:net";
import { UserInputError } from "./errors.js";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "openlink.khu.ac.kr",
  "webgate.khu.ac.kr",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".invalid", ".test"];

export function validatePublicTargetUrl(input: string): URL {
  if (input.length === 0 || input.length > 4096) {
    throw new UserInputError("Target URL must be between 1 and 4096 characters.");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UserInputError("Target URL must be an absolute HTTP or HTTPS URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserInputError("Only HTTP and HTTPS target URLs are supported.");
  }
  if (url.username || url.password) {
    throw new UserInputError("Target URLs must not contain usernames or passwords.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    BLOCKED_HOSTS.has(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new UserInputError("Target URL must use a public publisher or repository host.");
  }
  if (isIP(hostname) !== 0) {
    throw new UserInputError("Literal IP addresses are not accepted as target hosts.");
  }

  return url;
}
