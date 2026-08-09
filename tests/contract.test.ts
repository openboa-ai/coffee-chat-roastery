import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, test } from "vitest";

const temporaryRoots: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, "..");

function temporaryRepository(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  mkdirSync(join(root, "contract"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("protected contract bundle", () => {
  test("hashes sorted regular files with stable length framing", async () => {
    const root = temporaryRepository("roastery-contract-digest-");
    mkdirSync(join(root, "contract", "nested"));
    writeFileSync(join(root, "contract", "nested", "b.txt"), "beta\n");
    writeFileSync(join(root, "contract", "a.txt"), "alpha\n");

    const { digestContractBundle } = await import("../src/contract/digest.js");

    await expect(digestContractBundle(root)).resolves.toBe(
      "sha256:e8c8cff9d2093bdaecfb63c50ea75333dc8f1ec97c17b042db765eed3c035768",
    );
  });

  test("rejects a bundle whose contract tree contains a symbolic link", async () => {
    const root = temporaryRepository("roastery-contract-symlink-");
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "outside\n");
    symlinkSync(outside, join(root, "contract", "linked.txt"));

    const { digestContractBundle } = await import("../src/contract/digest.js");

    await expect(digestContractBundle(root)).rejects.toThrow(
      /regular files|symbolic link/u,
    );
  });

  test("ships closed schemas that reject extra contract data", () => {
    const ajv = new Ajv2020.default({ allErrors: true, strict: true });
    const schemaCases = [
      {
        path: "contract/schemas/roastery.schema.json",
        valid: {
          repository: "https://github.com/example-owner/example-roastery",
          contract: {
            repository: "https://github.com/openboa-ai/coffee-chat-roastery",
            commit: "1".repeat(40),
            digest: `sha256:${"2".repeat(64)}`,
          },
        },
      },
      {
        path: "contract/schemas/index.schema.json",
        valid: {
          beans: [
            {
              id: "01890f3a-2b00-7000-8000-000000000001",
              content_digest: `sha256:${"3".repeat(64)}`,
            },
          ],
        },
      },
      {
        path: "contract/schemas/bean-frontmatter.schema.json",
        valid: {
          id: "01890f3a-2b00-7000-8000-000000000001",
          origins: ["https://example.com/source"],
        },
      },
      {
        path: "contract/schemas/content-license.schema.json",
        valid: {
          scope: "roastery/beans/**",
          license: "CC-BY-4.0",
          attribution: "Example Owner",
        },
      },
      {
        path: "contract/schemas/rights-semantics.schema.json",
        valid: {
          scope: "roastery/beans/**",
          spdx_identifier: "CC-BY-4.0",
          official_license_url: "https://creativecommons.org/licenses/by/4.0/",
          normalized_attribution: "Example Owner",
          status: "supported",
          attribution_required: true,
          change_indication_required: true,
          product_provenance_required: true,
        },
      },
    ] as const;

    for (const schemaCase of schemaCases) {
      const schema = JSON.parse(
        readFileSync(resolve(repositoryRoot, schemaCase.path), "utf8"),
      );
      const validate = ajv.compile(schema);
      expect(validate(schemaCase.valid), schemaCase.path).toBe(true);
      expect(
        validate({ ...schemaCase.valid, unexpected: "must fail" }),
        schemaCase.path,
      ).toBe(false);
    }
  });

  test("keeps the Bean schema and validator aligned for public Origins", async () => {
    const cases = [
      {
        name: "public DNS Origin",
        origin: "https://Example.com:443/source?id=1",
        expected: true,
      },
      {
        name: "non-HTTPS Origin",
        origin: "http://example.com/source",
        expected: false,
      },
      {
        name: "credential-bearing Origin",
        origin: "https://owner@example.com/source",
        expected: false,
      },
      {
        name: "IPv4 Origin",
        origin: "https://127.0.0.1/private",
        expected: false,
      },
      {
        name: "IPv6 Origin",
        origin: "https://[::1]/private",
        expected: false,
      },
      {
        name: "single-label Origin",
        origin: "https://intranet/private",
        expected: false,
      },
      {
        name: "special-use Origin",
        origin: "https://service.InTeRnAl/private",
        expected: false,
      },
    ] as const;
    const id = "01890f3a-2b00-7000-8000-000000000001";
    const schema = JSON.parse(
      readFileSync(
        resolve(
          repositoryRoot,
          "contract/schemas/bean-frontmatter.schema.json",
        ),
        "utf8",
      ),
    );
    const validateSchema = new Ajv2020.default({
      allErrors: true,
      strict: true,
    }).compile(schema);
    const { validateBeanFile } = await import("../src/validation/bean.js");

    for (const { name, origin, expected } of cases) {
      const beanBytes = Buffer.from(
        `---\nid: ${id}\norigins:\n  - ${origin}\n---\nBody.\n`,
      );

      expect(
        validateSchema({ id, origins: [origin] }),
        `${name}: ${JSON.stringify(validateSchema.errors)}`,
      ).toBe(expected);
      expect(
        validateBeanFile(`roastery/beans/${id}.md`, beanBytes).status,
        name,
      ).toBe(expected ? "valid" : "invalid");
    }
  });

  test("publishes a manifest whose declared files exactly match the bundle", () => {
    const contract = JSON.parse(
      readFileSync(resolve(repositoryRoot, "contract/contract.json"), "utf8"),
    );
    const declaredPaths = Object.values(contract.files).sort();
    const expectedPaths = [
      "contract/publication.md",
      "contract/schemas/bean-frontmatter.schema.json",
      "contract/schemas/content-license.schema.json",
      "contract/schemas/contract-refresh-evidence.schema.json",
      "contract/schemas/contract-refresh-receipt.schema.json",
      "contract/schemas/index.schema.json",
      "contract/schemas/rights-semantics.schema.json",
      "contract/schemas/roastery.schema.json",
      "contract/security.md",
      "contract/templates/content-license.md",
    ].sort();

    expect(contract.repository).toBe(
      "https://github.com/openboa-ai/coffee-chat-roastery",
    );
    expect(declaredPaths).toEqual(expectedPaths);
    expect(contract.digest).toEqual({
      algorithm: "sha256",
      file_count_bytes: 4,
      path_length_bytes: 4,
      content_length_bytes: 8,
      byte_order: "big-endian",
      path_base: "contract/",
      path_order: "utf8-bytewise",
    });
    expect(
      createHash("sha256")
        .update(readFileSync(resolve(repositoryRoot, "LICENSE")))
        .digest("hex"),
    ).toHaveLength(64);
  });
});
