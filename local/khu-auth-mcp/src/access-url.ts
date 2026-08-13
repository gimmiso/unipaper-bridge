import { isIP } from "node:net";

const PROXY_PREFIXES = {
  "khu-seoul": "https://openlink.khu.ac.kr/link.n2s?url=",
  "khu-global": "https://webgate.khu.ac.kr/link.n2s?url=",
} as const;

export type KHUInstitutionId = keyof typeof PROXY_PREFIXES;

const blockedSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".invalid",
  ".test",
  ".home.arpa",
];

export function buildKHUAccessURL(
  institutionId: KHUInstitutionId,
  rawTarget: string,
): string {
  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new Error("invalid_target");
  }

  const hostname = target.hostname.toLowerCase();
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username !== "" ||
    target.password !== "" ||
    hostname === "localhost" ||
    isIP(hostname.replace(/^\[|\]$/g, "")) !== 0 ||
    blockedSuffixes.some((suffix) => hostname.endsWith(suffix)) ||
    hostname === "openlink.khu.ac.kr" ||
    hostname === "webgate.khu.ac.kr"
  ) {
    throw new Error("invalid_target");
  }

  return `${PROXY_PREFIXES[institutionId]}${encodeURIComponent(target.toString())}`;
}
