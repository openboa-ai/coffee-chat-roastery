import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

function run(...args) {
  return spawnSync(process.execPath, [join(root, "dist/cli.js"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("the installed CLI exposes only the deferred public commands without writes", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "roastery-shell-"));
  const sentinel = join(sandbox, "sentinel.txt");
  writeFileSync(sentinel, "unchanged\n");

  try {
    for (const command of ["validate", "project-index", "contract-digest"]) {
      const result = run(command, "--root", sandbox);
      assert.equal(result.status, 1, `${command} must fail closed`);
      assert.deepEqual(JSON.parse(result.stdout), {
        command,
        status: "not_implemented",
      });
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
