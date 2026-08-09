import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

const temporaryRoots: string[] = [];
const firstId = "01890f3a-2b00-7000-8000-000000000001";
const secondId = "01890f3a-2b00-7000-8000-000000000002";

function temporaryRoastery(): string {
  const root = mkdtempSync(join(tmpdir(), "roastery-validator-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "roastery", "beans"), { recursive: true });
  return root;
}

function digest(bytes: string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Bean and index contract", () => {
  test("accepts lowercase UUIDv7 paths, public HTTPS Origins, and a non-empty body", async () => {
    const bytes = `---\nid: ${secondId}\norigins:\n  - https://example.com/source?id=2\n---\nOwner-approved body.\n`;
    const { validateBeanFile } = await import("../src/validation/bean.js");

    expect(
      validateBeanFile(`roastery/beans/${secondId}.md`, Buffer.from(bytes)),
    ).toEqual({
      status: "valid",
      bean: {
        id: secondId,
        origins: ["https://example.com/source?id=2"],
        body: "Owner-approved body.\n",
      },
    });
  });

  test.each([
    {
      name: "path and frontmatter ID mismatch",
      path: `roastery/beans/${firstId}.md`,
      bytes: `---\nid: ${secondId}\n---\nBody.\n`,
      reason: "bean_id_path_mismatch",
    },
    {
      name: "unknown frontmatter field",
      path: `roastery/beans/${firstId}.md`,
      bytes: `---\nid: ${firstId}\ntitle: forbidden\n---\nBody.\n`,
      reason: "invalid_bean_frontmatter",
    },
    {
      name: "non-public Origin",
      path: `roastery/beans/${firstId}.md`,
      bytes: `---\nid: ${firstId}\norigins:\n  - https://127.0.0.1/private\n---\nBody.\n`,
      reason: "invalid_origin",
    },
    {
      name: "IPv4-mapped loopback Origin",
      path: `roastery/beans/${firstId}.md`,
      bytes: `---\nid: ${firstId}\norigins:\n  - https://[::ffff:127.0.0.1]/private\n---\nBody.\n`,
      reason: "invalid_origin",
    },
    {
      name: "shared-space IPv4 Origin",
      path: `roastery/beans/${firstId}.md`,
      bytes: `---\nid: ${firstId}\norigins:\n  - https://100.64.0.1/private\n---\nBody.\n`,
      reason: "invalid_origin",
    },
    {
      name: "special-use hostname Origin",
      path: `roastery/beans/${firstId}.md`,
      bytes: `---\nid: ${firstId}\norigins:\n  - https://service.internal/private\n---\nBody.\n`,
      reason: "invalid_origin",
    },
    {
      name: "empty body",
      path: `roastery/beans/${firstId}.md`,
      bytes: `---\nid: ${firstId}\n---\n \n`,
      reason: "empty_bean_body",
    },
  ])("rejects $name", async ({ path, bytes, reason }) => {
    const { validateBeanFile } = await import("../src/validation/bean.js");
    expect(validateBeanFile(path, Buffer.from(bytes))).toMatchObject({
      status: "invalid",
      reason,
    });
  });

  test("projects exact deterministic index bytes in monotonic lexical order", async () => {
    const root = temporaryRoastery();
    const firstBytes = `---\nid: ${firstId}\n---\nFirst body.\n`;
    const secondBytes = `---\nid: ${secondId}\norigins:\n  - https://example.com/source\n---\nSecond body.\n`;
    writeFileSync(
      join(root, "roastery", "beans", `${secondId}.md`),
      secondBytes,
    );
    writeFileSync(join(root, "roastery", "beans", `${firstId}.md`), firstBytes);

    const { projectIndexBytes } = await import("../src/projection/index.js");
    const expected = `${JSON.stringify(
      {
        beans: [
          { id: firstId, content_digest: digest(firstBytes) },
          { id: secondId, content_digest: digest(secondBytes) },
        ],
      },
      null,
      2,
    )}\n`;

    await expect(projectIndexBytes(root)).resolves.toBe(expected);
  });
});

describe("Roastery repository contract", () => {
  test("accepts only normalized repository identity and the complete contract tuple", async () => {
    const { validateRoasteryManifest } =
      await import("../src/validation/roastery.js");
    const manifest = {
      repository: "https://github.com/example-owner/example-roastery",
      contract: {
        repository: "https://github.com/openboa-ai/coffee-chat-roastery",
        commit: "1".repeat(40),
        digest: `sha256:${"2".repeat(64)}`,
      },
    };

    expect(validateRoasteryManifest(manifest)).toEqual({
      status: "valid",
      manifest,
    });
    expect(
      validateRoasteryManifest({
        ...manifest,
        repository: "https://github.com/Example-Owner/example-roastery/",
      }),
    ).toMatchObject({ status: "invalid", reason: "invalid_repository" });
    expect(
      validateRoasteryManifest({ ...manifest, extra: true }),
    ).toMatchObject({ status: "invalid", reason: "invalid_roastery_manifest" });
    expect(
      validateRoasteryManifest({
        ...manifest,
        contract: { ...manifest.contract, commit: "short" },
      }),
    ).toMatchObject({ status: "invalid", reason: "invalid_contract_pin" });
  });

  test("fails closed when the committed index omits, duplicates, or mis-digests a Bean", async () => {
    const root = temporaryRoastery();
    const beanBytes = `---\nid: ${firstId}\n---\nBody.\n`;
    writeFileSync(join(root, "roastery", "beans", `${firstId}.md`), beanBytes);
    writeFileSync(
      join(root, "roastery", "index.json"),
      `${JSON.stringify(
        {
          beans: [
            {
              id: firstId,
              content_digest: `sha256:${"0".repeat(64)}`,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const { validateCommittedIndex } =
      await import("../src/validation/index.js");
    await expect(validateCommittedIndex(root)).resolves.toMatchObject({
      status: "invalid",
      reason: "index_digest_mismatch",
    });
  });
});
