import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { renderContentLicense } from "../dist/index.js";

const contract = {
  repository: "https://github.com/openboa-ai/coffee-chat-roastery",
  commit: "d7d770af59a691b5ebceee9809ab436f32db33d5",
  digest:
    "sha256:878704aa835d167ea6ef6979f7cd0258cf02476b3f7c16926779f4f18ce75428",
};

function ownerFork() {
  const root = mkdtempSync(join(tmpdir(), "roastery-owner-fork-"));
  mkdirSync(join(root, "roastery"), { recursive: true });
  writeFileSync(
    join(root, "roastery", "roastery.json"),
    `${JSON.stringify(
      {
        repository: "https://github.com/example/coffee-chat",
        contract,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, "roastery", "index.json"), '{\n  "beans": []\n}\n');
  writeFileSync(
    join(root, "roastery", "CONTENT_LICENSE.md"),
    renderContentLicense("Example Owner").content,
  );
  return root;
}

function check(root, expectedRepository) {
  return spawnSync(
    process.execPath,
    [
      "scripts/check-repository-state.mjs",
      "--root",
      root,
      "--expected-repository",
      expectedRepository,
    ],
    { encoding: "utf8" },
  );
}

test("publication CI accepts a canonical initialized owner fork without mutating it", () => {
  const root = ownerFork();
  try {
    const manifestPath = join(root, "roastery", "roastery.json");
    const licensePath = join(root, "roastery", "CONTENT_LICENSE.md");
    const before = [readFileSync(manifestPath), readFileSync(licensePath)];

    const result = check(root, "https://github.com/example/coffee-chat");

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      beanCount: 0,
      repository: "https://github.com/example/coffee-chat",
      status: "valid",
    });
    assert.deepEqual(
      [readFileSync(manifestPath), readFileSync(licensePath)],
      before,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("publication CI rejects a repository identity mismatch without mutating it", () => {
  const root = ownerFork();
  try {
    const manifestPath = join(root, "roastery", "roastery.json");
    const before = readFileSync(manifestPath);

    const result = check(root, "https://github.com/another/coffee-chat");

    assert.equal(result.status, 1);
    assert.equal(result.stderr, "", result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      code: "identity_mismatch",
      status: "invalid",
    });
    assert.deepEqual(readFileSync(manifestPath), before);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
