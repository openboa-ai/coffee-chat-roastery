import { createHash } from "node:crypto";

export const CONTENT_LICENSE_SCOPE = "roastery/beans/**" as const;
export const CONTENT_LICENSE_ID = "CC-BY-4.0" as const;
export const CONTENT_LICENSE_URL =
  "https://creativecommons.org/licenses/by/4.0/" as const;
export const ATTRIBUTION_PLACEHOLDER = "<OWNER_PROVIDED_ATTRIBUTION>" as const;

export type ContentLicenseErrorCode =
  "invalid_content_license" | "unsupported_content_license";

export class ContentLicenseError extends Error {
  readonly code: ContentLicenseErrorCode;

  constructor(code: ContentLicenseErrorCode, message: string) {
    super(message);
    this.name = "ContentLicenseError";
    this.code = code;
  }
}

export interface ContentLicense {
  attribution: string;
  content: string;
  digest: `sha256:${string}`;
  license: typeof CONTENT_LICENSE_ID;
  scope: typeof CONTENT_LICENSE_SCOPE;
}

function invalid(message: string): never {
  throw new ContentLicenseError("invalid_content_license", message);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff)
        return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function normalizeAttribution(input: string): string {
  if (typeof input !== "string") invalid("attribution must be a string");
  if (input.trim() !== input) invalid("attribution has surrounding whitespace");

  const normalized = input.normalize("NFC");
  const length = [...normalized].length;
  if (length < 1 || length > 120)
    invalid("attribution length is outside 1-120");
  if (
    /[<>\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(normalized) ||
    hasUnpairedSurrogate(normalized) ||
    normalized === ATTRIBUTION_PLACEHOLDER ||
    /^<[^>]+>$/u.test(normalized)
  ) {
    invalid("attribution contains a forbidden value");
  }
  return normalized;
}

function body(attribution: string): string {
  return [
    "# Bean content license",
    "",
    `Scope: \`${CONTENT_LICENSE_SCOPE}\``,
    `License: \`${CONTENT_LICENSE_ID}\``,
    `Attribution: ${attribution}`,
    `License URL: ${CONTENT_LICENSE_URL}`,
    "Origin exclusion: Origin URLs and the resources they identify are outside this Bean-content license.",
    "Rights authority: The publisher may license only rights they own or control.",
    "",
  ].join("\n");
}

function content(attribution: string): string {
  return [
    "---",
    `scope: ${CONTENT_LICENSE_SCOPE}`,
    `license: ${CONTENT_LICENSE_ID}`,
    `attribution: ${JSON.stringify(attribution)}`,
    "---",
    "",
    body(attribution),
  ].join("\n");
}

function result(attribution: string): ContentLicense {
  const rendered = content(attribution);
  return {
    attribution,
    content: rendered,
    digest: `sha256:${createHash("sha256").update(rendered).digest("hex")}`,
    license: CONTENT_LICENSE_ID,
    scope: CONTENT_LICENSE_SCOPE,
  };
}

export function renderContentLicense(attributionInput: string): ContentLicense {
  return result(normalizeAttribution(attributionInput));
}

export function parseContentLicense(source: string): ContentLicense {
  if (typeof source !== "string") invalid("content license must be text");
  const lines = source.split("\n");
  if (
    lines[0] !== "---" ||
    lines[1] !== `scope: ${CONTENT_LICENSE_SCOPE}` ||
    !lines[2]?.startsWith("license: ") ||
    !lines[3]?.startsWith("attribution: ") ||
    lines[4] !== "---" ||
    lines[5] !== ""
  ) {
    invalid("content-license frontmatter is not canonical");
  }

  const identifier = lines[2].slice("license: ".length);
  if (identifier !== CONTENT_LICENSE_ID) {
    if (/^[A-Za-z0-9][A-Za-z0-9.-]*$/u.test(identifier)) {
      throw new ContentLicenseError(
        "unsupported_content_license",
        `unsupported content license: ${identifier}`,
      );
    }
    invalid("content-license identifier is malformed");
  }

  let attribution: unknown;
  try {
    attribution = JSON.parse(lines[3].slice("attribution: ".length));
  } catch {
    invalid("attribution is not a canonical quoted scalar");
  }
  if (typeof attribution !== "string") {
    invalid("attribution must be a string");
  }
  const parsed = result(normalizeAttribution(attribution));
  if (parsed.content !== source) {
    invalid("content-license body or serialization does not match");
  }
  return parsed;
}
