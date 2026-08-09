import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const attribution = "Café Owner";
const contentLicenseSchema = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "contract/schemas/content-license.schema.json"),
    "utf8",
  ),
);
const validateContentLicenseFrontmatter = new Ajv2020.default({
  allErrors: true,
  strict: true,
}).compile(contentLicenseSchema);
const expectedDeclaration = `---
scope: roastery/beans/**
license: CC-BY-4.0
attribution: "Café Owner"
---

# Bean Content License

The files under \`roastery/beans/**\` are licensed under \`CC-BY-4.0\`.

Attribution: Café Owner

Official license: https://creativecommons.org/licenses/by/4.0/

Origin URLs and the resources they identify are excluded from this Bean content
license.

The publisher can license only rights they own or control.
`;

describe("fixed Standard Roastery content declaration", () => {
  test("renders and parses one deterministic fixed-scope CC BY declaration", async () => {
    const { renderContentLicense } =
      await import("../src/projection/content-license.js");
    const { parseContentLicense } =
      await import("../src/validation/content-license.js");

    const rendered = renderContentLicense({
      scope: "roastery/beans/**",
      license: "CC-BY-4.0",
      attribution,
    });
    expect(rendered).toBe(expectedDeclaration);
    expect(parseContentLicense(rendered)).toEqual({
      status: "supported",
      declaration: {
        scope: "roastery/beans/**",
        license: "CC-BY-4.0",
        attribution,
        official_license_url: "https://creativecommons.org/licenses/by/4.0/",
      },
    });
  });

  test("keeps the documentation template parser-invalid and non-installable", async () => {
    const template = readFileSync(
      resolve(repositoryRoot, "contract/templates/content-license.md"),
      "utf8",
    );
    const { parseContentLicense } =
      await import("../src/validation/content-license.js");

    expect(parseContentLicense(template)).toMatchObject({
      status: "invalid_content_license",
      reason: "invalid_attribution",
    });
  });

  test("rejects Unicode line separators across renderer, parser, and schema", async () => {
    const { renderContentLicense } =
      await import("../src/projection/content-license.js");
    const { parseContentLicense } =
      await import("../src/validation/content-license.js");

    for (const separator of ["\u2028", "\u2029"]) {
      const unsafeAttribution = `Owner${separator}Name`;
      expect(() =>
        renderContentLicense({
          scope: "roastery/beans/**",
          license: "CC-BY-4.0",
          attribution: unsafeAttribution,
        }),
      ).toThrow(/attribution/u);
      expect(
        validateContentLicenseFrontmatter({
          scope: "roastery/beans/**",
          license: "CC-BY-4.0",
          attribution: unsafeAttribution,
        }),
      ).toBe(false);
      expect(
        parseContentLicense(
          expectedDeclaration.replaceAll(attribution, unsafeAttribution),
        ),
      ).toMatchObject({ status: "invalid_content_license" });
    }
  });

  test("uses the schema-enforceable 120 Unicode code-point attribution limit", async () => {
    const { renderContentLicense } =
      await import("../src/projection/content-license.js");
    const { parseContentLicense } =
      await import("../src/validation/content-license.js");
    const { validateContractBundle } =
      await import("../src/validation/contract-bundle.js");
    const atLimit = "\u{1fad8}".repeat(120);
    const overLimit = "a".repeat(121);
    const declarationAtLimit = expectedDeclaration.replaceAll(
      attribution,
      atLimit,
    );

    expect(
      validateContentLicenseFrontmatter({
        scope: "roastery/beans/**",
        license: "CC-BY-4.0",
        attribution: atLimit,
      }),
    ).toBe(true);
    expect(
      renderContentLicense({
        scope: "roastery/beans/**",
        license: "CC-BY-4.0",
        attribution: atLimit,
      }),
    ).toBe(declarationAtLimit);
    expect(parseContentLicense(declarationAtLimit)).toMatchObject({
      status: "supported",
      declaration: { attribution: atLimit },
    });
    await expect(
      validateContractBundle(
        repositoryRoot,
        Buffer.from(declarationAtLimit, "utf8"),
      ),
    ).resolves.toMatchObject({
      validation: "passed",
    });

    expect(
      validateContentLicenseFrontmatter({
        scope: "roastery/beans/**",
        license: "CC-BY-4.0",
        attribution: overLimit,
      }),
    ).toBe(false);
    expect(() =>
      renderContentLicense({
        scope: "roastery/beans/**",
        license: "CC-BY-4.0",
        attribution: overLimit,
      }),
    ).toThrow(/120 Unicode code points/u);
  });

  test.each([
    {
      name: "alias",
      source: expectedDeclaration.replace(
        'attribution: "Café Owner"',
        "attribution: *owner",
      ),
    },
    {
      name: "custom tag",
      source: expectedDeclaration.replace(
        'attribution: "Café Owner"',
        'attribution: !owner "Café Owner"',
      ),
    },
    {
      name: "unknown field",
      source: expectedDeclaration.replace(
        "license: CC-BY-4.0\n",
        "license: CC-BY-4.0\nmode: custom\n",
      ),
    },
    {
      name: "multiline attribution",
      source: expectedDeclaration.replace(
        'attribution: "Café Owner"',
        "attribution: |\n  Café Owner",
      ),
    },
    {
      name: "frontmatter and body disagreement",
      source: expectedDeclaration.replace(
        "Attribution: Café Owner",
        "Attribution: Different Owner",
      ),
    },
  ])("rejects safe-YAML boundary failure: $name", async ({ source }) => {
    const { parseContentLicense } =
      await import("../src/validation/content-license.js");
    expect(parseContentLicense(source)).toMatchObject({
      status: "invalid_content_license",
    });
  });

  test("distinguishes a well-formed unsupported identifier from invalid metadata", async () => {
    const { parseContentLicense } =
      await import("../src/validation/content-license.js");
    const unsupported = expectedDeclaration.replaceAll("CC-BY-4.0", "CC0-1.0");
    const missing = expectedDeclaration.replace("license: CC-BY-4.0\n", "");

    expect(parseContentLicense(unsupported)).toEqual({
      status: "unsupported_content_license",
      identifier: "CC0-1.0",
    });
    expect(parseContentLicense(missing)).toMatchObject({
      status: "invalid_content_license",
    });
  });

  test("rejects alternate scope or license rendering and invalid attribution", async () => {
    const { renderContentLicense } =
      await import("../src/projection/content-license.js");

    expect(() =>
      renderContentLicense({
        scope: "roastery/**",
        license: "CC-BY-4.0",
        attribution,
      }),
    ).toThrow(/scope/u);
    expect(() =>
      renderContentLicense({
        scope: "roastery/beans/**",
        license: "CC0-1.0",
        attribution,
      }),
    ).toThrow(/license/u);
    expect(() =>
      renderContentLicense({
        scope: "roastery/beans/**",
        license: "CC-BY-4.0",
        attribution: ` ${attribution}`,
      }),
    ).toThrow(/attribution/u);
  });
});
