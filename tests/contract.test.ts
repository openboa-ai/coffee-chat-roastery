import { createHash } from "node:crypto";
import {
  cpSync,
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
const INIT_CONTRACT = `# Standard Roastery Init Contract

Init is a Plugin-owned operation that consumes this fixed producer contract.
This repository defines the Preview and acceptance boundary; it does not
implement Plugin UI, GitHub orchestration, or write-side state transitions.

## Exact Preview before every write

Before any fork, branch, pull request, file, or Registry write, Init MUST show
one exact Preview containing:

- the public source repository
  \`https://github.com/openboa-ai/coffee-chat-roastery\`;
- the target owner, repository name \`coffee-chat\`, public visibility, and
  default branch;
- the affected local Registry state and the branch/pull-request process;
- the recovery boundary;
- the validated owner attribution;
- the exact rendered \`roastery/CONTENT_LICENSE.md\` bytes; and
- the SHA-256 digest of those exact declaration bytes.

The same Preview MUST state all seven fixed notice facts:

1. Standard Roastery Beans are public.
2. CC BY 4.0 permits sharing, commercial use, and adaptations, including
   AI-assisted or AI-generated adaptations.
3. Downstream users must provide attribution, link the license, and indicate
   changes without implying endorsement.
4. The grant is not revocable for recipients who already received it under the
   license.
5. The publisher may license only rights they own or control.
6. Origin URLs and the resources they identify are excluded.
7. An AI Coffee response is not the publisher's original wording or endorsement.

## Exact acceptance

Init MAY begin its first write only after the user explicitly accepts that exact
Preview, the rendered declaration and digest, the owner attribution, and the
rights-authority attestation. Acceptance is single-use and bound to the complete
Preview. Any changed Preview is stale and requires a new acceptance.

## Zero-write outcomes

Rejection, cancellation, invalid attribution, missing authority, or a stale
Preview MUST produce zero fork, branch, pull-request, file, and Registry writes.
No partial initialization, default acceptance, alternate license mode, or reused
acceptance is permitted.
`;

function temporaryRepository(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  mkdirSync(join(root, "contract"), { recursive: true });
  return root;
}

function copyDeclaredBundle(destination: string): void {
  const contract = JSON.parse(
    readFileSync(resolve(repositoryRoot, "contract/contract.json"), "utf8"),
  ) as { files: Record<string, string> };
  for (const path of [
    "contract/contract.json",
    ...Object.values(contract.files),
  ]) {
    mkdirSync(resolve(destination, path, ".."), { recursive: true });
    cpSync(resolve(repositoryRoot, path), resolve(destination, path));
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("protected contract bundle", () => {
  test("ships the fixed Init Preview, acceptance, and zero-write contract bytes", () => {
    expect(
      readFileSync(resolve(repositoryRoot, "contract/init.md"), "utf8"),
    ).toBe(INIT_CONTRACT);
  });

  test("binds contract and runtime authority bytes through one manifest", async () => {
    const root = temporaryRepository("roastery-contract-digest-");
    copyDeclaredBundle(root);
    writeFileSync(join(root, "contract", "init.md"), INIT_CONTRACT);

    const { digestContractBundle } = await import("../src/contract/digest.js");
    const original = await digestContractBundle(root);

    writeFileSync(
      join(root, "dist", "validation", "bean.js"),
      `${readFileSync(join(root, "dist", "validation", "bean.js"), "utf8")}\n`,
    );
    const runtimeChanged = await digestContractBundle(root);
    writeFileSync(
      join(root, "contract", "init.md"),
      `${readFileSync(join(root, "contract", "init.md"), "utf8")}\n`,
    );
    const initChanged = await digestContractBundle(root);

    expect(runtimeChanged).not.toBe(original);
    expect(initChanged).not.toBe(runtimeChanged);
  });

  test("rejects a bundle whose contract tree contains a symbolic link", async () => {
    const root = temporaryRepository("roastery-contract-symlink-");
    copyDeclaredBundle(root);
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "outside\n");
    rmSync(join(root, "contract", "publication.md"));
    symlinkSync(outside, join(root, "contract", "publication.md"));

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

  test("keeps Origin URL semantics out of the structural Bean schema", async () => {
    const cases = [
      {
        name: "public DNS Origin",
        origin: "https://Example.com:443/source?id=1",
        validatorStatus: "valid",
      },
      {
        name: "maximum HTTPS port",
        origin: "https://example.com:65535/source",
        validatorStatus: "valid",
      },
      {
        name: "out-of-range HTTPS port",
        origin: "https://example.com:65536/source",
        validatorStatus: "invalid",
      },
      {
        name: "non-HTTPS Origin",
        origin: "http://example.com/source",
        validatorStatus: "invalid",
      },
      {
        name: "credential-bearing Origin",
        origin: "https://owner@example.com/source",
        validatorStatus: "invalid",
      },
      {
        name: "IPv4 Origin",
        origin: "https://127.0.0.1/private",
        validatorStatus: "invalid",
      },
      {
        name: "IPv6 Origin",
        origin: "https://[::1]/private",
        validatorStatus: "invalid",
      },
      {
        name: "single-label Origin",
        origin: "https://intranet/private",
        validatorStatus: "invalid",
      },
      {
        name: "special-use Origin",
        origin: "https://service.InTeRnAl/private",
        validatorStatus: "invalid",
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

    for (const { name, origin, validatorStatus } of cases) {
      const beanBytes = Buffer.from(
        `---\nid: ${id}\norigins:\n  - ${origin}\n---\nBody.\n`,
      );

      expect(
        validateSchema({ id, origins: [origin] }),
        `${name}: ${JSON.stringify(validateSchema.errors)}`,
      ).toBe(true);
      expect(
        validateBeanFile(`roastery/beans/${id}.md`, beanBytes).status,
        name,
      ).toBe(validatorStatus);
    }
  });

  test("publishes one tracked and packageable manifest for every vendored authority", () => {
    const contract = JSON.parse(
      readFileSync(resolve(repositoryRoot, "contract/contract.json"), "utf8"),
    );
    const declaredPaths = Object.values(contract.files).sort();
    const expectedPaths = [
      "contract/init.md",
      "contract/publication.md",
      "contract/schemas/bean-frontmatter.schema.json",
      "contract/schemas/content-license.schema.json",
      "contract/schemas/index.schema.json",
      "contract/schemas/roastery.schema.json",
      "contract/security.md",
      "contract/templates/content-license.md",
      "dist/cli.js",
      "dist/contract/digest.js",
      "dist/contract/manifest.js",
      "dist/contract/types.js",
      "dist/index.js",
      "dist/projection/content-license.js",
      "dist/projection/index.js",
      "dist/validation/bean.js",
      "dist/validation/content-license.js",
      "dist/validation/contract-bundle.js",
      "dist/validation/filesystem.js",
      "dist/validation/index.js",
      "dist/validation/publication.js",
      "dist/validation/repository.js",
      "dist/validation/roastery.js",
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
      path_base: "repository",
      path_order: "utf8-bytewise",
    });
    expect(
      createHash("sha256")
        .update(readFileSync(resolve(repositoryRoot, "LICENSE")))
        .digest("hex"),
    ).toHaveLength(64);
  });
});
