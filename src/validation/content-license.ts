import { TextDecoder } from "node:util";

import {
  CONTENT_LICENSE_IDENTIFIER,
  CONTENT_LICENSE_SCOPE,
  CONTENT_LICENSE_URL,
} from "../contract/types.ts";
import {
  normalizeOwnerAttribution,
  renderContentLicense,
} from "../projection/content-license.ts";

export interface SupportedContentLicense {
  scope: typeof CONTENT_LICENSE_SCOPE;
  license: typeof CONTENT_LICENSE_IDENTIFIER;
  attribution: string;
  official_license_url: typeof CONTENT_LICENSE_URL;
}

export type ContentLicenseParseResult =
  | { status: "supported"; declaration: SupportedContentLicense }
  | { status: "invalid_content_license"; reason: string }
  | { status: "unsupported_content_license"; identifier: string };

const utf8 = new TextDecoder("utf-8", { fatal: true });
const SPDX_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9.-]*$/u;

function invalid(reason: string): ContentLicenseParseResult {
  return { status: "invalid_content_license", reason };
}

export function parseContentLicense(
  input: string | Uint8Array,
): ContentLicenseParseResult {
  let source: string;
  try {
    source = typeof input === "string" ? input : utf8.decode(input);
  } catch {
    return invalid("invalid_utf8");
  }
  if (source.includes("\r") || !source.startsWith("---\n")) {
    return invalid("invalid_frontmatter");
  }
  const boundary = source.indexOf("\n---\n", 4);
  if (boundary < 0) return invalid("invalid_frontmatter");
  const lines = source.slice(4, boundary).split("\n");
  if (lines.length !== 3) return invalid("invalid_frontmatter");

  const scopeMatch = /^scope: (\S+)$/u.exec(lines[0] ?? "");
  const licenseMatch = /^license: ([A-Za-z0-9.-]+)$/u.exec(lines[1] ?? "");
  const attributionMatch = /^attribution: (".*")$/u.exec(lines[2] ?? "");
  if (!scopeMatch || !licenseMatch || !attributionMatch) {
    return invalid("invalid_frontmatter");
  }
  if (scopeMatch[1] !== CONTENT_LICENSE_SCOPE) return invalid("invalid_scope");
  const identifier = licenseMatch[1] ?? "";
  if (!SPDX_IDENTIFIER.test(identifier)) return invalid("invalid_license");

  let attribution: unknown;
  try {
    attribution = JSON.parse(attributionMatch[1] ?? "");
  } catch {
    return invalid("invalid_attribution");
  }
  let normalizedAttribution: string;
  try {
    normalizedAttribution = normalizeOwnerAttribution(attribution);
  } catch {
    return invalid("invalid_attribution");
  }
  if (attribution !== normalizedAttribution) {
    return invalid("invalid_attribution");
  }

  if (identifier !== CONTENT_LICENSE_IDENTIFIER) {
    return { status: "unsupported_content_license", identifier };
  }
  const expected = renderContentLicense({
    scope: CONTENT_LICENSE_SCOPE,
    license: CONTENT_LICENSE_IDENTIFIER,
    attribution: normalizedAttribution,
  });
  if (source !== expected) return invalid("declaration_body_mismatch");

  return {
    status: "supported",
    declaration: {
      scope: CONTENT_LICENSE_SCOPE,
      license: CONTENT_LICENSE_IDENTIFIER,
      attribution: normalizedAttribution,
      official_license_url: CONTENT_LICENSE_URL,
    },
  };
}
