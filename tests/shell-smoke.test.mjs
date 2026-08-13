import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computeContractDigest } from "../dist/index.js";

const root = new URL("..", import.meta.url).pathname;
const MAX_ROASTERY_JSON_BYTES = 64 * 1024;
const MAX_CONTRACT_FILE_BYTES = 2 * 1024 * 1024;

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
    const externalIndex = join(sandbox, "external-index.json");
    writeFileSync(externalIndex, '{\n  "beans": []\n}\n');
    mkdirSync(join(sandbox, "roastery"));
    symlinkSync(externalIndex, join(sandbox, "roastery", "index.json"));
    const linkedIndex = run("project-index", "--root", sandbox, "--check");
    assert.equal(linkedIndex.status, 1);
    assert.deepEqual(JSON.parse(linkedIndex.stdout), {
      code: "unsafe_path",
      status: "invalid",
    });
    const unknown = run("publication-check");
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /unknown command/u);
  } finally {
    rmSync(sandbox, { force: true, recursive: true });
  }
});

test(
  "validation rejects a named pipe without waiting for a writer",
  { skip: process.platform === "win32" },
  () => {
    const sandbox = mkdtempSync(join(tmpdir(), "roastery-fifo-"));
    const roastery = join(sandbox, "roastery");
    mkdirSync(roastery);
    execFileSync("mkfifo", [join(roastery, "roastery.json")]);
    try {
      const result = spawnSync(
        process.execPath,
        [
          join(root, "dist/cli.js"),
          "validate",
          "--root",
          sandbox,
          "--contract-commit",
          "a".repeat(40),
          "--contract-digest",
          `sha256:${"b".repeat(64)}`,
          "--format",
          "json",
        ],
        { cwd: root, encoding: "utf8", timeout: 1_000 },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.deepEqual(JSON.parse(result.stdout), {
        code: "unsafe_path",
        status: "invalid",
      });
    } finally {
      rmSync(sandbox, { force: true, recursive: true });
    }
  },
);

test("CLI rejects oversized repository and contract inputs", () => {
  const repository = mkdtempSync(join(tmpdir(), "roastery-cli-resource-"));
  const contractRepository = mkdtempSync(
    join(tmpdir(), "roastery-cli-contract-resource-"),
  );
  try {
    mkdirSync(join(repository, "roastery"));
    writeFileSync(
      join(repository, "roastery", "roastery.json"),
      Buffer.alloc(MAX_ROASTERY_JSON_BYTES + 1, 0x61),
    );
    writeFileSync(
      join(repository, "roastery", "index.json"),
      '{\n  "beans": []\n}\n',
    );
    const validation = run(
      "validate",
      "--root",
      repository,
      "--contract-commit",
      "a".repeat(40),
      "--contract-digest",
      `sha256:${"b".repeat(64)}`,
    );
    assert.equal(validation.status, 1);
    assert.deepEqual(JSON.parse(validation.stdout), {
      code: "resource_limit_exceeded",
      status: "invalid",
    });

    cpSync(join(root, "contract"), join(contractRepository, "contract"), {
      recursive: true,
    });
    writeFileSync(
      join(contractRepository, "contract", "security.md"),
      Buffer.alloc(MAX_CONTRACT_FILE_BYTES + 1, 0x62),
    );
    const digest = run("contract-digest", "--root", contractRepository);
    assert.equal(digest.status, 1);
    assert.deepEqual(JSON.parse(digest.stdout), {
      code: "unsafe_contract_entry",
      status: "invalid",
    });
  } finally {
    rmSync(repository, { force: true, recursive: true });
    rmSync(contractRepository, { force: true, recursive: true });
  }
});

test("policy retains the central trusted wrapper and native squash authority", () => {
  const policy = JSON.parse(
    readFileSync(join(root, ".github/merge-policy.json"), "utf8"),
  );
  assert.deepEqual(policy.eligible_author_associations, ["OWNER", "MEMBER"]);
  assert.deepEqual(policy.eligible_bot_logins, ["dependabot[bot]"]);
  assert.equal(policy.merge_method, "squash");
  assert.equal(policy.auto_merge, "github-native");
  assert.equal(policy.merge_queue, false);
  assert.deepEqual(policy.required_events, ["pull_request"]);
  assert.equal(policy.required_approvals, 0);
  const wrapper = readFileSync(
    join(root, ".github/workflows/trusted.yml"),
    "utf8",
  );
  assert.match(wrapper, /pull_request_target:/u);
  assert.match(
    wrapper,
    /uses: openboa-ai\/\.github\/\.github\/workflows\/coffee-trusted-gate\.yml@[0-9a-f]{40}/u,
  );
  assert.doesNotMatch(wrapper, /^\s*run:/mu);
  assert.doesNotMatch(wrapper, /secrets\./u);
});
