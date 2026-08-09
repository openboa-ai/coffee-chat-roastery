import {
  CONTENT_LICENSE_IDENTIFIER,
  CONTENT_LICENSE_SCOPE,
  CONTENT_LICENSE_URL,
} from "../contract/types.ts";

export interface ContentLicenseRenderInput {
  scope: string;
  license: string;
  attribution: string;
}

const INVALID_ATTRIBUTION_CHARACTER =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

export function normalizeOwnerAttribution(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("attribution must be a string");
  }
  const normalized = value.normalize("NFC");
  if (
    value !== value.trim() ||
    normalized.length === 0 ||
    INVALID_ATTRIBUTION_CHARACTER.test(normalized) ||
    normalized === "<OWNER_PROVIDED_ATTRIBUTION>"
  ) {
    throw new Error("attribution is invalid");
  }
  if ([...normalized].length > 120) {
    throw new Error("attribution must be at most 120 Unicode code points");
  }
  return normalized;
}

export function renderContentLicense(input: ContentLicenseRenderInput): string {
  if (input.scope !== CONTENT_LICENSE_SCOPE) {
    throw new Error(`scope must be ${CONTENT_LICENSE_SCOPE}`);
  }
  if (input.license !== CONTENT_LICENSE_IDENTIFIER) {
    throw new Error(`license must be ${CONTENT_LICENSE_IDENTIFIER}`);
  }
  const attribution = normalizeOwnerAttribution(input.attribution);
  return `---
scope: ${CONTENT_LICENSE_SCOPE}
license: ${CONTENT_LICENSE_IDENTIFIER}
attribution: ${JSON.stringify(attribution)}
---

# Bean Content License

The files under \`${CONTENT_LICENSE_SCOPE}\` are licensed under \`${CONTENT_LICENSE_IDENTIFIER}\`.

Attribution: ${attribution}

Official license: ${CONTENT_LICENSE_URL}

Origin URLs and the resources they identify are excluded from this Bean content
license.

The publisher can license only rights they own or control.
`;
}
