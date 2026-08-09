import { createHash } from "node:crypto";

import type { ContentLicensePolicy } from "../contract/types.ts";
import { parseContentLicense } from "../validation/content-license.ts";

export interface RightsSemanticsProjection {
  scope: string | null;
  spdx_identifier: string | null;
  official_license_url: string | null;
  normalized_attribution: string | null;
  status: "supported" | "invalid";
  attribution_required: boolean | null;
  change_indication_required: boolean | null;
  product_provenance_required: boolean | null;
}

export function projectRightsSemantics(
  declarationBytes: string | Uint8Array,
): RightsSemanticsProjection {
  const parsed = parseContentLicense(declarationBytes);
  if (parsed.status !== "supported") {
    return {
      scope: null,
      spdx_identifier: null,
      official_license_url: null,
      normalized_attribution: null,
      status: "invalid",
      attribution_required: null,
      change_indication_required: null,
      product_provenance_required: null,
    };
  }
  return {
    scope: parsed.declaration.scope,
    spdx_identifier: parsed.declaration.license,
    official_license_url: parsed.declaration.official_license_url,
    normalized_attribution: parsed.declaration.attribution,
    status: "supported",
    attribution_required: true,
    change_indication_required: true,
    product_provenance_required: true,
  };
}

export function projectRightsSemanticsWithPolicy(
  declarationBytes: string | Uint8Array,
  policy: ContentLicensePolicy,
): RightsSemanticsProjection {
  const parsed = parseContentLicense(declarationBytes);
  if (parsed.status !== "supported") {
    return projectRightsSemantics(declarationBytes);
  }
  return {
    scope: policy.scope,
    spdx_identifier: policy.spdx_identifier,
    official_license_url: policy.official_license_url,
    normalized_attribution: parsed.declaration.attribution.normalize(
      policy.attribution_normalization,
    ),
    status: policy.supported ? "supported" : "invalid",
    attribution_required: policy.attribution_required,
    change_indication_required: policy.change_indication_required,
    product_provenance_required: policy.product_provenance_required,
  };
}

export function serializeRightsSemantics(
  projection: RightsSemanticsProjection,
): string {
  const ordered: RightsSemanticsProjection = {
    scope: projection.scope,
    spdx_identifier: projection.spdx_identifier,
    official_license_url: projection.official_license_url,
    normalized_attribution: projection.normalized_attribution,
    status: projection.status,
    attribution_required: projection.attribution_required,
    change_indication_required: projection.change_indication_required,
    product_provenance_required: projection.product_provenance_required,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function digestRightsSemantics(
  projectionBytes: string | Uint8Array,
): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(projectionBytes).digest("hex")}`;
}
