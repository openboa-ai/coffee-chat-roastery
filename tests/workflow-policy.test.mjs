import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const checker = join(repositoryRoot, ".github/ci-policy.mjs");

async function withFixture(mutate, check) {
  const fixture = await mkdtemp(join(tmpdir(), "roastery-workflow-policy-"));

  try {
    await cp(
      join(repositoryRoot, "package.json"),
      join(fixture, "package.json"),
    );
    await cp(join(repositoryRoot, ".github"), join(fixture, ".github"), {
      recursive: true,
    });
    await mutate(fixture);
    await check(fixture);
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
}

async function replace(fixture, relativePath, from, to) {
  const target = join(fixture, relativePath);
  const source = await readFile(target, "utf8");
  assert.ok(source.includes(from), `fixture source must include ${from}`);
  await writeFile(target, source.replace(from, to));
}

async function runChecker(fixture) {
  try {
    const result = await execFileAsync(process.execPath, [checker], {
      env: { ...process.env, ROASTERY_CI_POLICY_ROOT: fixture },
    });
    return { output: `${result.stdout}${result.stderr}`, status: 0 };
  } catch (error) {
    const failure =
      /** @type {{code?: number, stderr?: string, stdout?: string}} */ (error);
    return {
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
      status: failure.code,
    };
  }
}

async function expectRejected(mutate, message) {
  await withFixture(mutate, async (fixture) => {
    const result = await runChecker(fixture);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, message);
  });
}

test("accepts the checked-in workflow policy", async () => {
  const result = await runChecker(repositoryRoot);
  assert.equal(result.status, 0, result.output);
});

test("rejects duplicate YAML mapping keys", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "name: Roastery quality\n",
        "name: Roastery quality\nname: Duplicate quality\n",
      ),
    /workflow must parse uniquely/u,
  );
});

test("rejects an escaped job-level permission override", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "  eligibility:\n    name: Roastery author eligibility\n    runs-on: ubuntu-24.04\n    timeout-minutes: 15\n    permissions:\n      contents: read",
        '  eligibility:\n    name: Roastery author eligibility\n    runs-on: ubuntu-24.04\n    timeout-minutes: 15\n    "permiss\\u0069ons":\n      contents: write',
      ),
    /job permissions/u,
  );
});

test("rejects a flow-style escaped unpinned action", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "    steps:\n      - name: Check out repository without persisted credentials",
        '    steps:\n      - { "u\\u0073es": actions/checkout@v7 }\n      - name: Check out repository without persisted credentials',
      ),
    /unapproved action/u,
  );
});

test("rejects an aliased unpinned action", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "    steps:\n      - name: Check out repository without persisted credentials",
        "    steps:\n      - &unpinned\n        uses: actions/checkout@v7\n      - *unpinned\n      - name: Check out repository without persisted credentials",
      ),
    /unapproved action/u,
  );
});

test("rejects a future workflow even when it is read-only", async () => {
  await expectRejected(
    (fixture) =>
      writeFile(
        join(fixture, ".github/workflows/future.yml"),
        "name: Future\non:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  future:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: 'true'\n",
      ),
    /workflow set/u,
  );
});

test("rejects an extra pull_request_target trigger", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "  pull_request:\n",
        "  pull_request:\n  pull_request_target: {}\n",
      ),
    /approved triggers/u,
  );
});

test("rejects a missing bounded job timeout", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "    timeout-minutes: 15\n",
        "",
      ),
    /timeout-minutes/u,
  );
});

test("rejects a weakened dependency-review threshold", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/policy.yml",
        "          fail-on-severity: moderate\n",
        "",
      ),
    /dependency-review inputs/u,
  );
});

test("rejects an inexact merge-group reference", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/policy.yml",
        "${{ github.event.merge_group.base_sha }}",
        "${{ github.event.merge_group.base_ref }}",
      ),
    /exact merge-group refs/u,
  );
});

test("rejects removal of the quality-owned policy step", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "      - run: npm run ci:policy\n",
        "",
      ),
    /quality job runs the policy command/u,
  );
});

test("rejects moving the policy step outside the quality job", async () => {
  await expectRejected(async (fixture) => {
    await replace(
      fixture,
      ".github/workflows/quality.yml",
      "      - run: npm run ci:policy\n",
      "",
    );
    await replace(
      fixture,
      ".github/workflows/quality.yml",
      "jobs:\n",
      "jobs:\n  auxiliary:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: npm run ci:policy\n\n",
    );
  }, /quality job runs the policy command/u);
});

test("rejects weakening the package policy command", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        "package.json",
        "node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs",
        "node .github/ci-policy.mjs",
      ),
    /package command/u,
  );
});

test("documents GitHub-native selective-review auto-merge", async () => {
  const [agentContract, pullRequestTemplate] = await Promise.all([
    readFile(join(repositoryRoot, "AGENTS.md"), "utf8"),
    readFile(join(repositoryRoot, ".github/PULL_REQUEST_TEMPLATE.md"), "utf8"),
  ]);

  assert.match(agentContract, /pull request/u);
  assert.match(agentContract, /GitHub-native squash auto-merge/u);
  assert.match(agentContract, /organization rules.*human review/iu);
  assert.match(agentContract, /custom write-token merge automation/u);
  assert.doesNotMatch(
    agentContract,
    /Human approval is not a merge condition/u,
  );
  assert.match(pullRequestTemplate, /Sensitive path/u);
  assert.match(pullRequestTemplate, /GitHub-native squash auto-merge/u);
});
