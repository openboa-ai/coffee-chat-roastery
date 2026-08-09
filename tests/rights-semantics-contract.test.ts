import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

describe("canonical rights-semantics projection", () => {
  test("serializes the supported declaration in fixed field order with one LF", async () => {
    const { renderContentLicense } =
      await import("../src/projection/content-license.js");
    const { projectRightsSemantics, serializeRightsSemantics } =
      await import("../src/projection/rights-semantics.js");
    const declaration = renderContentLicense({
      scope: "roastery/beans/**",
      license: "CC-BY-4.0",
      attribution: "Café Owner",
    });

    const bytes = serializeRightsSemantics(projectRightsSemantics(declaration));
    const expected = `${JSON.stringify(
      {
        scope: "roastery/beans/**",
        spdx_identifier: "CC-BY-4.0",
        official_license_url: "https://creativecommons.org/licenses/by/4.0/",
        normalized_attribution: "Café Owner",
        status: "supported",
        attribution_required: true,
        change_indication_required: true,
        product_provenance_required: true,
      },
      null,
      2,
    )}\n`;

    expect(bytes).toBe(expected);
    expect(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    ).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  test("uses explicit nulls instead of omitted or inferred semantics for invalid metadata", async () => {
    const { projectRightsSemantics, serializeRightsSemantics } =
      await import("../src/projection/rights-semantics.js");
    const bytes = serializeRightsSemantics(
      projectRightsSemantics("not a declaration\n"),
    );

    expect(JSON.parse(bytes)).toEqual({
      scope: null,
      spdx_identifier: null,
      official_license_url: null,
      normalized_attribution: null,
      status: "invalid",
      attribution_required: null,
      change_indication_required: null,
      product_provenance_required: null,
    });
    expect(bytes.endsWith("\n")).toBe(true);
    expect(bytes.endsWith("\n\n")).toBe(false);
  });
});
