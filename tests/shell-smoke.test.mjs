import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computeContractDigest } from "../dist/index.js";

const root = new URL("..", import.meta.url).pathname;

function run(...args) {
  return spawnSync(process.execPath, [join(root, "dist/cli.js"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("the CLI exposes the three contract commands and fails closed without writes", () => {
  const digest = run("contract-digest", "--root", root, "--format", "json");
  assert.equal(digest.status, 0);
  assert.deepEqual(JSON.parse(digest.stdout), {
    digest: computeContractDigest(root),
    status: "valid",
  });

  const sandbox = mkdtempSync(join(tmpdir(), "roastery-cli-"));
  const sentinel = join(sandbox, "sentinel.txt");
  writeFileSync(sentinel, "unchanged\n");
  try {
    for (const command of ["validate", "project-index"]) {
      const result = run(command, "--root", sandbox, "--check");
      assert.equal(result.status, 1, `${command} must fail closed`);
      assert.equal(JSON.parse(result.stdout).status, "invalid");
      assert.equal(readFileSync(sentinel, "utf8"), "unchanged\n");
    }
    const unknown = run("publication-check");
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /unknown command/u);
  } finally {
    rmSync(sandbox, { force: true, recursive: true });
  }
});

test("policy retains the three lean workflows and native squash authority", () => {
  const policy = JSON.parse(
    readFileSync(join(root, ".github/merge-policy.json"), "utf8"),
  );
  assert.deepEqual(policy.eligible_author_associations, ["OWNER", "MEMBER"]);
  assert.equal(policy.merge_method, "squash");
  assert.equal(policy.auto_merge, "github-native");
  assert.equal(policy.required_approvals, 0);

  const workflows = ["quality.yml", "policy.yml", "codeql.yml"];
  for (const workflow of workflows) {
    const source = readFileSync(
      join(root, ".github/workflows", workflow),
      "utf8",
    );
    assert.match(source, /pull_request:/u);
    assert.match(source, /merge_group:/u);
  }
});
