import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  checkIndex,
  projectIndex,
  renderContentLicense,
  validate,
} from "../dist/index.js";

/** @type {import("../dist/index.js").ContractPin} */
const contract = {
  repository: "https://github.com/openboa-ai/coffee-chat-roastery",
  commit: "a".repeat(40),
  digest: `sha256:${"b".repeat(64)}`,
};

function fixture({
  repository = "https://github.com/openboa-ai/coffee-chat-roastery",
  initialized = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "roastery-fixture-"));
  mkdirSync(join(root, "roastery"), { recursive: true });
  writeFileSync(
    join(root, "roastery", "roastery.json"),
    `${JSON.stringify(
      {
        repository,
        contract,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "roastery", "index.json"),
    `${JSON.stringify({ beans: [] }, null, 2)}\n`,
  );
  if (initialized) {
    writeFileSync(
      join(root, "roastery", "CONTENT_LICENSE.md"),
      renderContentLicense("Example Owner").content,
    );
  }
  return root;
}

test("one validator accepts the Bean-free seed and an initialized owner fork", () => {
  const seed = fixture();
  const danglingBeans = fixture();
  const owner = fixture({
    initialized: true,
    repository: "https://github.com/example/coffee-chat",
  });
  const invalidRepositories = [
    "https://github.com/exam\tple/coffee-chat",
    "https://github.com/example\\coffee-chat",
  ].map((repository) => fixture({ initialized: true, repository }));
  try {
    assert.deepEqual(
      validate({ root: seed, mode: "seed", expectedContract: contract }),
      {
        beanCount: 0,
        repository: "https://github.com/openboa-ai/coffee-chat-roastery",
        status: "valid",
      },
    );
    symlinkSync(
      join(danglingBeans, "missing-beans"),
      join(danglingBeans, "roastery", "beans"),
    );
    assert.deepEqual(
      validate({
        root: danglingBeans,
        mode: "seed",
        expectedContract: contract,
      }),
      { code: "unsafe_path", status: "invalid" },
    );
    unlinkSync(join(danglingBeans, "roastery", "beans"));
    unlinkSync(join(danglingBeans, "roastery", "roastery.json"));
    writeFileSync(
      join(danglingBeans, "roastery", "roastery.json"),
      `{
  "repository": "https://github.com/attacker/coffee-chat-roastery",
  "repository": "https://github.com/openboa-ai/coffee-chat-roastery",
  "contract": ${JSON.stringify(contract)}
}\n`,
    );
    assert.deepEqual(
      validate({
        root: danglingBeans,
        mode: "seed",
        expectedContract: contract,
      }),
      { code: "invalid_roastery", status: "invalid" },
    );
    writeFileSync(
      join(danglingBeans, "roastery", "roastery.json"),
      `${JSON.stringify(
        {
          repository: "https://github.com/openboa-ai/coffee-chat-roastery",
          contract,
        },
        null,
        2,
      )}\n`,
    );
    symlinkSync(
      join(danglingBeans, "missing-license"),
      join(danglingBeans, "roastery", "CONTENT_LICENSE.md"),
    );
    assert.deepEqual(
      validate({
        root: danglingBeans,
        mode: "seed",
        expectedContract: contract,
      }),
      { code: "unsafe_path", status: "invalid" },
    );
    unlinkSync(join(danglingBeans, "roastery", "CONTENT_LICENSE.md"));
    unlinkSync(join(danglingBeans, "roastery", "roastery.json"));
    symlinkSync("index.json", join(danglingBeans, "roastery", "roastery.json"));
    assert.deepEqual(
      validate({
        root: danglingBeans,
        mode: "seed",
        expectedContract: contract,
      }),
      { code: "unsafe_path", status: "invalid" },
    );
    assert.deepEqual(
      validate({
        root: owner,
        mode: "initialized",
        expectedContract: contract,
      }),
      {
        beanCount: 0,
        repository: "https://github.com/example/coffee-chat",
        status: "valid",
      },
    );
    for (const root of invalidRepositories) {
      assert.deepEqual(
        validate({
          root,
          mode: "initialized",
          expectedContract: contract,
        }),
        { code: "invalid_repository_identity", status: "invalid" },
      );
    }
    assert.deepEqual(
      validate({
        root: owner,
        mode: "initialized",
        expectedContract: { ...contract, digest: `sha256:${"c".repeat(64)}` },
      }),
      { code: "contract_mismatch", status: "invalid" },
    );
    rmSync(join(owner, "roastery", "CONTENT_LICENSE.md"));
    assert.deepEqual(
      validate({
        root: owner,
        mode: "initialized",
        expectedContract: contract,
      }),
      {
        code: "invalid_content_license",
        status: "invalid",
      },
    );
  } finally {
    rmSync(seed, { force: true, recursive: true });
    rmSync(danglingBeans, { force: true, recursive: true });
    rmSync(owner, { force: true, recursive: true });
    for (const root of invalidRepositories) {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

test("projection is deterministic and validation rejects unsafe or stale Bean state", () => {
  const root = fixture({
    initialized: true,
    repository: "https://github.com/example/coffee-chat",
  });
  const external = mkdtempSync(join(tmpdir(), "roastery-external-"));
  const externalTarget = join(external, "must-not-change.txt");
  writeFileSync(externalTarget, "unchanged\n");
  mkdirSync(join(root, "roastery", "beans"));
  const id = "018f0f31-9d95-7c89-8f7a-9de83bb3f123";
  const bean = `---\nid: ${id}\norigins:\n  - https://example.com/source\n---\n\nA deliberate point of view.\n`;
  const beanPath = join(root, "roastery", "beans", `${id}.md`);
  writeFileSync(beanPath, bean);

  try {
    const originalIndex = readFileSync(
      join(root, "roastery", "index.json"),
      "utf8",
    );
    const projected = projectIndex({ root });
    const expectedDigest = `sha256:${createHash("sha256").update(bean).digest("hex")}`;
    const expectedIndex = `${JSON.stringify(
      { beans: [{ id, digest: expectedDigest }] },
      null,
      2,
    )}\n`;
    assert.deepEqual(projected, {
      beans: [{ digest: expectedDigest, id }],
      bytes: expectedIndex,
      status: "projected",
    });
    assert.equal(
      readFileSync(join(root, "roastery", "index.json"), "utf8"),
      originalIndex,
    );
    writeFileSync(join(root, "roastery", "index.json"), projected.bytes);
    assert.equal(
      validate({ root, mode: "initialized", expectedContract: contract })
        .status,
      "valid",
    );

    for (const unsafeOrigin of [
      "localhost",
      "localhost.",
      "printer.local.",
      ".",
      "foo..bar",
      "-bad.example",
      "bad-.example",
      "printer",
      "foo.test",
      "service.invalid",
      "router.home.arpa",
      "hidden.onion",
      "service.internal",
      "private.alt",
      "exam\tple.com",
      "example.com\\source",
      "EXAMPLE.com",
      "example.com:443",
      "example.com.",
      "127.0.0.1",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
      "[::]",
      "[::1]",
      "[::ffff:127.0.0.1]",
    ]) {
      writeFileSync(beanPath, bean.replace("example.com", unsafeOrigin));
      assert.deepEqual(
        validate({ root, mode: "initialized", expectedContract: contract }),
        {
          code: "invalid_origin",
          status: "invalid",
        },
      );
    }
    writeFileSync(
      beanPath,
      bean.replace(
        "  - https://example.com/source\n",
        "  - https://example.com/source\n  - https://example.com/source\n",
      ),
    );
    assert.deepEqual(
      validate({ root, mode: "initialized", expectedContract: contract }),
      {
        code: "duplicate_origin",
        status: "invalid",
      },
    );
    writeFileSync(
      beanPath,
      bean.replace(
        "  - https://example.com/source\n",
        "  - https://example.com/source\n  - https://example.com/source \n",
      ),
    );
    assert.deepEqual(
      validate({ root, mode: "initialized", expectedContract: contract }),
      {
        code: "invalid_origin",
        status: "invalid",
      },
    );

    writeFileSync(beanPath, bean);
    const unsafeBean = join(root, "roastery", "beans", "escape.md");
    symlinkSync("../index.json", unsafeBean);
    assert.deepEqual(
      validate({ root, mode: "initialized", expectedContract: contract }),
      {
        code: "unsafe_path",
        status: "invalid",
      },
    );
    unlinkSync(unsafeBean);

    const indexPath = join(root, "roastery", "index.json");
    unlinkSync(indexPath);
    symlinkSync(externalTarget, indexPath);
    assert.equal(projectIndex({ root }).bytes, expectedIndex);
    assert.deepEqual(checkIndex({ root }), {
      code: "unsafe_path",
      status: "invalid",
    });
    assert.equal(readFileSync(externalTarget, "utf8"), "unchanged\n");
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(external, { force: true, recursive: true });
  }
});
