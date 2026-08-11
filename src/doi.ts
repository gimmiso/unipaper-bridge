import { UserInputError } from "./errors.js";

const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i;

export type PaperQueryType = "doi" | "title";

export function normalizeDoi(input: string): string {
  let value = input.trim();

  if (value.length === 0 || value.length > 512) {
    throw new UserInputError("DOI must be between 1 and 512 characters.");
  }

  value = value.replace(/^doi:\s*/i, "");

  try {
    const candidate = new URL(value);
    const hostname = candidate.hostname.toLowerCase();
    if (hostname === "doi.org" || hostname === "dx.doi.org") {
      value = candidate.pathname.replace(/^\//, "");
    }
  } catch {
    value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  }

  try {
    value = decodeURIComponent(value);
  } catch {
    throw new UserInputError("DOI contains invalid percent encoding.");
  }

  if (!DOI_PATTERN.test(value)) {
    throw new UserInputError(
      "That does not look like a DOI. Use a value such as 10.1038/s41586-024-00000-0.",
    );
  }

  return value.toLowerCase();
}

export function normalizeTitle(input: string): string {
  const value = input.replace(/\s+/g, " ").trim();
  if (value.length < 3 || value.length > 500) {
    throw new UserInputError("Paper title must be between 3 and 500 characters.");
  }
  if (/\p{Cc}/u.test(value)) {
    throw new UserInputError("Paper title contains unsupported control characters.");
  }
  return value;
}

export function resolveQueryType(
  query: string,
  requested: "auto" | PaperQueryType,
): { type: PaperQueryType; value: string } {
  if (requested === "doi") {
    return { type: "doi", value: normalizeDoi(query) };
  }
  if (requested === "title") {
    return { type: "title", value: normalizeTitle(query) };
  }

  try {
    return { type: "doi", value: normalizeDoi(query) };
  } catch {
    return { type: "title", value: normalizeTitle(query) };
  }
}
