import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsRoot = resolve(root, ".github/workflows");

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function workflow(name) {
  return parse(readFileSync(resolve(workflowsRoot, name), "utf8"));
}

function runs(job) {
  return (job.steps ?? [])
    .filter((step) => typeof step.run === "string")
    .map((step) => step.run.trim());
}

function uses(value, found = []) {
  if (Array.isArray(value)) {
    for (const entry of value) uses(entry, found);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "uses") found.push(entry);
      uses(entry, found);
    }
  }
  return found;
}

function eligibilityResult(input) {
  const quality = workflow("quality.yml");
  const step = quality.jobs.eligibility.steps.find(
    (candidate) => candidate.name === "Decide author eligibility",
  );
  assert.ok(step, "workflow must expose one executable eligibility decision");
  return spawnSync("bash", ["-eu", "-o", "pipefail", "-c", step.run], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AUTHOR_ASSOCIATION: input.association ?? "",
      AUTHOR_LOGIN: input.login ?? "",
      EVENT_NAME: input.event,
    },
  });
}

test("required workflows expose one lean fail-closed Roastery decision", () => {
  assert.deepEqual(
    readdirSync(workflowsRoot)
      .filter((name) => /\.ya?ml$/u.test(name))
      .sort(),
    ["codeql.yml", "policy.yml", "quality.yml"],
  );

  const quality = workflow("quality.yml");
  assert.deepEqual(Object.keys(quality.jobs).sort(), [
    "aggregate",
    "eligibility",
    "publication",
    "quality",
    "upload-coverage",
  ]);
  assert.deepEqual(quality.jobs.aggregate.needs, [
    "eligibility",
    "quality",
    "publication",
  ]);
  assert.equal(quality.jobs.aggregate.if, "always()");
  const aggregate = JSON.stringify(quality.jobs.aggregate.steps);
  for (const state of ["failed", "invalid", "skipped", "unavailable"]) {
    assert.match(aggregate, new RegExp(state, "u"));
  }

  assert.deepEqual(runs(quality.jobs.quality), [
    "npm ci",
    "npm run format:check",
    "npm run typecheck",
    "npm run package:check",
    "npm run test:coverage",
    "npm run ci:policy",
  ]);
  assert.deepEqual(runs(quality.jobs.publication), [
    "npm ci",
    "npm run test:publication",
    "npm run check:publication",
  ]);
  assert.equal(quality.jobs.quality.needs, "eligibility");
  assert.equal(quality.jobs.publication.needs, "eligibility");
  assert.equal(quality.jobs["upload-coverage"].needs, "quality");
  assert.deepEqual(quality.jobs["upload-coverage"].permissions, {
    contents: "read",
    "code-quality": "write",
  });
});

test("author eligibility executes one exact decision for PR and merge-queue metadata", () => {
  const cases = [
    { name: "owner", event: "pull_request", association: "OWNER", want: 0 },
    { name: "member", event: "pull_request", association: "MEMBER", want: 0 },
    {
      name: "login cannot replace membership",
      event: "pull_request",
      association: "CONTRIBUTOR",
      login: "openboa",
      want: 1,
    },
    {
      name: "collaborator",
      event: "pull_request",
      association: "COLLABORATOR",
      login: "another-user",
      want: 1,
    },
    {
      name: "outsider",
      event: "pull_request",
      association: "NONE",
      login: "another-user",
      want: 1,
    },
    {
      name: "arbitrary login",
      event: "pull_request",
      association: "NONE",
      login: "arbitrary-login",
      want: 1,
    },
    { name: "missing metadata", event: "pull_request", want: 1 },
    { name: "merge group", event: "merge_group", want: 0 },
  ];

  for (const scenario of cases) {
    const result = eligibilityResult(scenario);
    assert.equal(
      result.status,
      scenario.want,
      `${scenario.name}: ${result.stdout}\n${result.stderr}`,
    );
  }
});

test("supply-chain and CodeQL workflows enforce their distinct boundaries", () => {
  const policy = workflow("policy.yml");
  assert.deepEqual(Object.keys(policy.jobs), ["dependency-review"]);
  assert.deepEqual(runs(policy.jobs["dependency-review"]), []);

  const codeql = workflow("codeql.yml");
  assert.deepEqual(Object.keys(codeql.jobs), ["analyze"]);
  assert.deepEqual(codeql.jobs.analyze.permissions, {
    contents: "read",
    actions: "read",
    "security-events": "write",
  });

  for (const name of ["codeql.yml", "policy.yml", "quality.yml"]) {
    const document = workflow(name);
    assert.deepEqual(document.permissions, {});
    assert.equal("pull_request_target" in document.on, false);
    for (const use of uses(document)) {
      assert.match(use, /^[^@\s]+@[0-9a-f]{40}$/u);
    }
  }
});

test("merge policy uses GitHub-native squash with no human approval gate", () => {
  const policy = readJson(".github/merge-policy.json");
  assert.equal(policy.repository_role, "roastery");
  assert.equal(policy.merge_method, "squash");
  assert.equal(policy.auto_merge, "github-native");
  assert.deepEqual(policy.eligible_author_associations, ["OWNER", "MEMBER"]);
  assert.equal("eligible_author_logins" in policy, false);
  assert.deepEqual(policy.review_policy, {
    required_approvals: 0,
    code_owner_reviews_required: false,
  });
  assert.deepEqual(
    policy.required_checks.map((entry) => entry.context),
    ["Roastery required", "Roastery dependency review"],
  );
});

test("the executable CI policy accepts the retained repository surface", () => {
  const result = spawnSync(
    process.execPath,
    [resolve(root, ".github/ci-policy.mjs")],
    {
      cwd: root,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /CI policy passed/u);
});
