import { UserInputError } from "./errors.js";
import { validatePublicTargetUrl } from "./safe-url.js";

export interface InstitutionAdapter {
  id: string;
  institution: string;
  campus: string;
  country: string;
  proxyPrefix: string;
  accessGuideUrl: string;
  fairUsePolicyUrl: string;
  usageNote: string;
  workingDownloadCeilingPerPublisherPerDay: number;
}

export interface PublicInstitutionAdapter {
  id: string;
  institution: string;
  campus: string;
  country: string;
  access_guide_url: string;
  fair_use_policy_url: string;
  access_url_pattern: string;
  authentication: "user_browser";
  credentials_handled_by_server: false;
  usage_note: string;
  working_download_ceiling_per_publisher_per_day: number;
}

export const INSTITUTIONS: readonly InstitutionAdapter[] = [
  {
    id: "khu-seoul",
    institution: "Kyung Hee University",
    campus: "Seoul Campus",
    country: "KR",
    proxyPrefix: "https://openlink.khu.ac.kr/link.n2s?url=",
    accessGuideUrl: "https://lib.khu.ac.kr/webcontent/info/1",
    fairUsePolicyUrl: "https://lib.khu.ac.kr/webcontent/info/2",
    usageNote:
      "Sign in to KHU Library in your own browser. Use licensed material only for personal research; do not automate or redistribute downloads.",
    workingDownloadCeilingPerPublisherPerDay: 20,
  },
  {
    id: "khu-global",
    institution: "Kyung Hee University",
    campus: "Global Campus",
    country: "KR",
    proxyPrefix: "https://webgate.khu.ac.kr/link.n2s?url=",
    accessGuideUrl: "https://lib.khu.ac.kr/webcontent/info/1",
    fairUsePolicyUrl: "https://lib.khu.ac.kr/webcontent/info/2",
    usageNote:
      "Sign in to KHU Library in your own browser. Use licensed material only for personal research; do not automate or redistribute downloads.",
    workingDownloadCeilingPerPublisherPerDay: 20,
  },
] as const;

export function listInstitutions(): PublicInstitutionAdapter[] {
  return INSTITUTIONS.map((adapter) => ({
    id: adapter.id,
    institution: adapter.institution,
    campus: adapter.campus,
    country: adapter.country,
    access_guide_url: adapter.accessGuideUrl,
    fair_use_policy_url: adapter.fairUsePolicyUrl,
    access_url_pattern: `${adapter.proxyPrefix}{target_url}`,
    authentication: "user_browser",
    credentials_handled_by_server: false,
    usage_note: adapter.usageNote,
    working_download_ceiling_per_publisher_per_day:
      adapter.workingDownloadCeilingPerPublisherPerDay,
  }));
}

export function buildInstitutionLink(institutionId: string, targetUrl: string) {
  const adapter = INSTITUTIONS.find((item) => item.id === institutionId);
  if (!adapter) {
    throw new UserInputError(
      `Unknown institution adapter '${institutionId}'. Call list_institutions first.`,
    );
  }

  const target = validatePublicTargetUrl(targetUrl).toString();
  return {
    institution_id: adapter.id,
    institution: adapter.institution,
    campus: adapter.campus,
    target_url: target,
    access_url: `${adapter.proxyPrefix}${target}`,
    authentication: "user_browser" as const,
    credentials_handled_by_server: false as const,
    access_guide_url: adapter.accessGuideUrl,
    fair_use_policy_url: adapter.fairUsePolicyUrl,
    usage_note: adapter.usageNote,
    next_steps: [
      "Open the access URL in your own browser.",
      "Sign in directly on the institution's site if prompted; never send credentials to the MCP server or model.",
      "Confirm the article title and DOI, then download only the individually selected paper if your licence permits it.",
      "Attach the lawfully obtained PDF to the conversation for full-text analysis.",
    ],
  };
}
