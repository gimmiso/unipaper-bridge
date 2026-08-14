import { isIP } from "node:net";
import { HelperError } from "./models.js";

const PROXY_HOSTS = new Set(["openlink.khu.ac.kr", "webgate.khu.ac.kr"]);
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".invalid",
  ".test",
  ".home.arpa",
];

function isSafePublicTarget(target: URL): boolean {
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    ["http:", "https:"].includes(target.protocol) &&
    target.username === "" &&
    target.password === "" &&
    host !== "localhost" &&
    !PROXY_HOSTS.has(host) &&
    !BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) &&
    isIP(host) === 0
  );
}

export function validateKHUAccessURL(rawValue: string): URL {
  let accessURL: URL;
  try {
    accessURL = new URL(rawValue);
  } catch {
    throw new HelperError("invalid_access_url");
  }
  const urlValues = accessURL.searchParams.getAll("url");
  if (
    rawValue.length > 4_096 ||
    accessURL.protocol !== "https:" ||
    !PROXY_HOSTS.has(accessURL.hostname.toLowerCase()) ||
    accessURL.pathname !== "/link.n2s" ||
    accessURL.username !== "" ||
    accessURL.password !== "" ||
    (accessURL.port !== "" && accessURL.port !== "443") ||
    accessURL.hash !== "" ||
    urlValues.length !== 1
  ) {
    throw new HelperError("invalid_access_url");
  }

  let target: URL;
  try {
    target = new URL(urlValues[0]!);
  } catch {
    throw new HelperError("invalid_access_url");
  }
  if (!isSafePublicTarget(target)) {
    throw new HelperError("invalid_access_url");
  }
  return accessURL;
}

export function validatePublicDownloadURL(rawValue: string): URL {
  if (rawValue.length > 4_096) throw new HelperError("invalid_access_url");
  let candidate: URL;
  try {
    candidate = new URL(rawValue);
  } catch {
    throw new HelperError("invalid_access_url");
  }
  if (PROXY_HOSTS.has(candidate.hostname.toLowerCase())) {
    return validateKHUAccessURL(rawValue);
  }
  if (!isSafePublicTarget(candidate)) throw new HelperError("invalid_access_url");
  return candidate;
}

export function isKHULoginURL(rawValue: string): boolean {
  try {
    const url = new URL(rawValue);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "lib.khu.ac.kr" &&
      (url.pathname === "/login" || url.pathname === "/login/")
    );
  } catch {
    return false;
  }
}
