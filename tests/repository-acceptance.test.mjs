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

import { projectIndex, renderContentLicense, validate } from "../dist/index.js";

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
  const owner = fixture({
    initialized: true,
    repository: "https://github.com/example/coffee-chat",
  });
  try {
    assert.deepEqual(validate({ root: seed, mode: "seed" }), {
      beanCount: 0,
      repository: "https://github.com/openboa-ai/coffee-chat-roastery",
      status: "valid",
    });
    assert.deepEqual(validate({ root: owner, mode: "initialized" }), {
      beanCount: 0,
      repository: "https://github.com/example/coffee-chat",
      status: "valid",
    });
    rmSync(join(owner, "roastery", "CONTENT_LICENSE.md"));
    assert.deepEqual(validate({ root: owner, mode: "initialized" }), {
      code: "invalid_content_license",
      status: "invalid",
    });
  } finally {
    rmSync(seed, { force: true, recursive: true });
    rmSync(owner, { force: true, recursive: true });
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
    const projected = projectIndex({ root, write: true });
    const expectedDigest = `sha256:${createHash("sha256").update(bean).digest("hex")}`;
    assert.deepEqual(projected, {
      beans: [{ digest: expectedDigest, id }],
      status: "projected",
      wrote: true,
    });
    assert.equal(
      readFileSync(join(root, "roastery", "index.json"), "utf8"),
      `${JSON.stringify(
        { beans: [{ id, digest: expectedDigest }] },
        null,
        2,
      )}\n`,
    );
    assert.equal(validate({ root, mode: "initialized" }).status, "valid");

    for (const unsafeOrigin of ["localhost", "127.0.0.1", "[::1]"]) {
      writeFileSync(beanPath, bean.replace("example.com", unsafeOrigin));
      assert.deepEqual(validate({ root, mode: "initialized" }), {
        code: "invalid_origin",
        status: "invalid",
      });
    }

    writeFileSync(beanPath, bean);
    const unsafeBean = join(root, "roastery", "beans", "escape.md");
    symlinkSync("../index.json", unsafeBean);
    assert.deepEqual(validate({ root, mode: "initialized" }), {
      code: "unsafe_path",
      status: "invalid",
    });
    unlinkSync(unsafeBean);

    const indexPath = join(root, "roastery", "index.json");
    unlinkSync(indexPath);
    symlinkSync(externalTarget, indexPath);
    assert.throws(() => projectIndex({ root, write: true }), /unsafe_path/u);
    assert.equal(readFileSync(externalTarget, "utf8"), "unchanged\n");
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(external, { force: true, recursive: true });
  }
});
