import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const emptyBase = "8d57df18eed80dc1a8e0e85466f240d08af6fdde";
const trustBaseCommit = "3231235c271bf0aa4382a4eb576421fa0c149596";
const workflowPaths = [
  ".github/workflows/policy.yml",
  ".github/workflows/quality.yml",
  ".github/workflows/codeql.yml",
];

function readText(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function repositoryPaths() {
  const changed = execFileSync(
    "git",
    [
      "-C",
      root,
      "diff",
      "--name-only",
      "--diff-filter=ACMRD",
      "-z",
      emptyBase,
      "--",
    ],
    { encoding: "utf8" },
  );
  const untracked = execFileSync(
    "git",
    ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  );
  return [
    ...new Set(`${changed}${untracked}`.split("\u0000").filter(Boolean)),
  ].sort();
}

function createRepositoryFixture(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const fixtureRoot = join(directory, "repository");
  execFileSync(
    "git",
    ["clone", "--quiet", "--no-hardlinks", "--no-checkout", root, fixtureRoot],
    { encoding: "utf8" },
  );
  execFileSync(
    "git",
    ["-C", fixtureRoot, "checkout", "--quiet", "--detach", emptyBase],
    { encoding: "utf8" },
  );
  for (const path of repositoryPaths()) {
    const targetPath = resolve(fixtureRoot, path);
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(resolve(root, path), targetPath, { recursive: true });
  }
  const fixtureModules = resolve(fixtureRoot, "node_modules");
  mkdirSync(fixtureModules);
  for (const entry of readdirSync(resolve(root, "node_modules"))) {
    symlinkSync(
      resolve(root, "node_modules", entry),
      resolve(fixtureModules, entry),
    );
  }
  return { directory, root: fixtureRoot };
}

function runMigrationChecker(checkerRoot, extraArguments = []) {
  return spawnSync(
    process.execPath,
    [
      resolve(checkerRoot, "scripts/check-migration-receipt.mjs"),
      "--root",
      checkerRoot,
      "--base",
      emptyBase,
      "--target",
      trustBaseCommit,
      ...extraArguments,
    ],
    { encoding: "utf8" },
  );
}

function collectByKey(value, key, found = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectByKey(entry, key, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) found.push(entryValue);
    collectByKey(entryValue, key, found);
  }
  return found;
}

function workflowEntries() {
  return workflowPaths.map((path) => ({
    path,
    bytes: readText(path),
    document: parse(readText(path)),
  }));
}

test("required workflows expose safe, always-created pull request evidence", () => {
  const entries = workflowEntries();
  const aggregateJobs = [];

  for (const { path, bytes, document } of entries) {
    assert.equal(typeof document, "object", `${path} must parse as YAML`);
    assert.ok(document.on?.pull_request !== undefined, `${path}: pull_request`);
    assert.ok(document.on?.merge_group !== undefined, `${path}: merge_group`);
    assert.equal(
      document.on.pull_request,
      null,
      `${path}: pull_request filters`,
    );
    assert.equal(document.on.merge_group, null, `${path}: merge_group filters`);
    assert.equal(document.on?.pull_request_target, undefined, path);
    assert.doesNotMatch(bytes, /\bsecrets\./u);
    assert.equal(collectByKey(document, "continue-on-error").length, 0, path);

    for (const use of collectByKey(document, "uses")) {
      assert.equal(typeof use, "string", `${path}: uses must be a string`);
      if (use.startsWith("./")) continue;
      assert.match(use, /^[^@\s]+@[0-9a-f]{40}$/u, `${path}: ${use}`);
    }

    for (const [jobId, job] of Object.entries(document.jobs ?? {})) {
      if (jobId === "aggregate") aggregateJobs.push({ path, job });
      const expectedPermissions =
        path.endsWith("codeql.yml") && jobId === "analyze"
          ? {
              actions: "read",
              contents: "read",
              "security-events": "write",
            }
          : { contents: "read" };
      assert.deepEqual(
        job.permissions,
        expectedPermissions,
        `${path}:${jobId}`,
      );
    }
  }

  assert.equal(aggregateJobs.length, 1, "exactly one aggregate job");
  const [{ job: aggregate }] = aggregateJobs;
  assert.equal(aggregate.if, "always()");
  assert.ok(Array.isArray(aggregate.needs) && aggregate.needs.length > 0);
  assert.match(JSON.stringify(aggregate.steps), /needs\./u);
});

test("default-branch analysis and grouped dependency maintenance are explicit", () => {
  const codeql = parse(readText(".github/workflows/codeql.yml"));
  assert.deepEqual(codeql.on.push, { branches: ["main"] });

  const dependabot = parse(readText(".github/dependabot.yml"));
  assert.equal(dependabot.updates.length, 2);
  for (const update of dependabot.updates) {
    assert.deepEqual(update.groups, {
      security: {
        "applies-to": "security-updates",
        patterns: ["*"],
      },
      versions: {
        "applies-to": "version-updates",
        patterns: ["*"],
      },
    });
  }
});

test("migration lanes fetch the immutable empty-base history", () => {
  for (const path of [
    ".github/workflows/policy.yml",
    ".github/workflows/quality.yml",
  ]) {
    const document = parse(readText(path));
    const checkoutSteps = collectByKey(document.jobs, "uses")
      .map((use, index) => ({ use, index }))
      .filter(({ use }) => String(use).startsWith("actions/checkout@"));
    assert.equal(checkoutSteps.length, 1, `${path}: checkout cardinality`);
    const jobs = Object.values(document.jobs ?? {});
    const checkout = jobs
      .flatMap((job) => job.steps ?? [])
      .find((step) => String(step.uses).startsWith("actions/checkout@"));
    assert.equal(checkout?.with?.["fetch-depth"], 0, path);
  }
});

test("merge policy and CODEOWNERS protect control-plane changes only", () => {
  const policy = readJson(".github/merge-policy.json");
  assert.equal(policy.repository_role, "roastery");
  assert.equal(policy.merge_method, "squash");
  assert.equal(policy.auto_merge.ordinary, true);
  assert.equal(policy.auto_merge.protected_after_code_owner_approval, true);
  assert.equal(policy.auto_merge.protected, undefined);
  assert.deepEqual(policy.required_events, ["merge_group", "pull_request"]);
  assert.deepEqual(policy.required_checks, [
    { context: "Roastery required", integration_id: 15368 },
    { context: "Roastery dependency review", integration_id: 15368 },
    {
      context: "Roastery CodeQL JavaScript-TypeScript",
      integration_id: 15368,
    },
  ]);

  const codeowners = readText("CODEOWNERS");
  assert.doesNotMatch(
    codeowners,
    /^\s*\*\s+/mu,
    "ordinary paths stay review-free",
  );
  for (const protectedPath of policy.protected_paths) {
    assert.match(
      codeowners,
      new RegExp(
        `^${protectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+@SonSangjoon$`,
        "mu",
      ),
    );
  }
});

test("migration evidence is recomputed from the reviewed trust-base tree", () => {
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, "scripts/check-migration-receipt.mjs"),
      "--root",
      root,
      "--base",
      emptyBase,
      "--target",
      trustBaseCommit,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.target_commit, trustBaseCommit);
  assert.equal(evidence.selected_rows, 35);
  assert.equal(evidence.changed_surfaces, 28);
});

test("CI preserves the bootstrap receipt when later allowed surfaces are added", () => {
  const fixture = createRepositoryFixture("roastery-post-bootstrap-");
  try {
    const laterPath = resolve(fixture.root, "docs/control-plane-canary.md");
    mkdirSync(dirname(laterPath), { recursive: true });
    writeFileSync(laterPath, "# Control-plane canary\n");
    const result = spawnSync(
      process.execPath,
      [resolve(fixture.root, ".github/ci-policy.mjs")],
      { cwd: fixture.root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("migration checker fails closed on receipt tampering", () => {
  const original = readJson(
    "docs/migration/receipts/task-4-governance-trust-base.json",
  );
  const cases = [
    {
      name: "unknown field",
      receipt: { ...original, unexpected: "must fail" },
      expected: /schema validation failed/u,
    },
    {
      name: "projection digest mismatch",
      receipt: { ...original, projection_sha256: "0".repeat(64) },
      expected: /projection digest mismatch/u,
    },
    {
      name: "missing changed surface",
      receipt: {
        ...original,
        changed_surfaces: original.changed_surfaces.slice(1),
      },
      expected: /receipt surfaces mismatch/u,
    },
  ];

  const directory = mkdtempSync(join(tmpdir(), "roastery-receipt-"));
  try {
    for (const scenario of cases) {
      const receiptPath = join(
        directory,
        `${scenario.name.replaceAll(" ", "-")}.json`,
      );
      writeFileSync(
        receiptPath,
        `${JSON.stringify(scenario.receipt, null, 2)}\n`,
      );
      const result = spawnSync(
        process.execPath,
        [
          resolve(root, "scripts/check-migration-receipt.mjs"),
          "--root",
          root,
          "--base",
          emptyBase,
          "--target",
          trustBaseCommit,
          "--receipt",
          receiptPath,
        ],
        { encoding: "utf8" },
      );
      assert.notEqual(result.status, 0, scenario.name);
      assert.match(result.stderr, scenario.expected, scenario.name);
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("migration checker rejects a self-consistent replacement of workspace authority", () => {
  const projection = readJson(
    "docs/migration/selections/task-4-governance-trust-base.json",
  );
  projection.ledger_sha256 = "0".repeat(64);
  projection.selected_rows = [];
  projection.changed_surface_classification =
    projection.changed_surface_classification.map((entry) => ({
      target_path_or_surface: entry.target_path_or_surface,
      classification: "new-authority",
      objective_or_failure_mode: "PR-authored replacement authority",
      observable_oracle: "PR-authored replacement oracle",
    }));

  const projectionBytes = canonicalJson(projection);
  const equality = readJson(
    "docs/migration/equality/task-4-governance-trust-base.json",
  );
  equality.ledger_sha256 = projection.ledger_sha256;
  equality.generator_sha256 = "1".repeat(64);
  equality.objective_selection_sha256 = "2".repeat(64);
  equality.projection_sha256 = sha256(projectionBytes);
  equality.changed_surface_classification_sha256 = sha256(
    canonicalJson({
      target_owner: projection.target_owner,
      task: projection.task,
      objective: projection.objective,
      changed_surface_classification: projection.changed_surface_classification,
    }),
  );
  const equalityBytes = canonicalJson(equality);

  const receipt = readJson(
    "docs/migration/receipts/task-4-governance-trust-base.json",
  );
  receipt.projection_sha256 = equality.projection_sha256;
  receipt.equality_receipt_sha256 = sha256(equalityBytes);
  receipt.rewrite_evidence = [];

  const directory = mkdtempSync(join(tmpdir(), "roastery-authority-"));
  try {
    const projectionPath = join(directory, "projection.json");
    const equalityPath = join(directory, "equality.json");
    const receiptPath = join(directory, "receipt.json");
    writeFileSync(projectionPath, projectionBytes);
    writeFileSync(equalityPath, equalityBytes);
    writeFileSync(receiptPath, canonicalJson(receipt));

    const result = runMigrationChecker(root, [
      "--projection",
      projectionPath,
      "--equality",
      equalityPath,
      "--receipt",
      receiptPath,
    ]);
    assert.notEqual(result.status, 0, "replacement authority must fail");
    assert.match(result.stderr, /reviewed migration authority/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("migration checker rejects evidence outside the repository", () => {
  const receipt = readJson(
    "docs/migration/receipts/task-4-governance-trust-base.json",
  );
  const directory = mkdtempSync(join(tmpdir(), "roastery-outside-evidence-"));
  try {
    const outsidePath = join(directory, "outside.txt");
    writeFileSync(outsidePath, "not repository evidence\n");
    receipt.rewrite_evidence = receipt.rewrite_evidence.map((entry) => ({
      ...entry,
      evidence: [`path:${outsidePath}`],
    }));
    const receiptPath = join(directory, "receipt.json");
    writeFileSync(receiptPath, canonicalJson(receipt));

    const result = runMigrationChecker(root, ["--receipt", receiptPath]);
    assert.notEqual(result.status, 0, "outside evidence must fail");
    assert.match(result.stderr, /inside the repository/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("migration checker executes the declared rewrite oracle", () => {
  const fixture = createRepositoryFixture("roastery-oracle-");
  try {
    const packagePath = resolve(fixture.root, "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.scripts["failing:oracle"] = 'node -e "process.exitCode = 17"';
    writeFileSync(packagePath, canonicalJson(packageJson));

    const policyPath = resolve(fixture.root, ".github/merge-policy.json");
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    policy.migration.oracle_commands = ["failing:oracle"];
    writeFileSync(policyPath, canonicalJson(policy));

    const receiptPath = resolve(
      fixture.root,
      "docs/migration/receipts/task-4-governance-trust-base.json",
    );
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    receipt.rewrite_evidence = receipt.rewrite_evidence.map((entry) => ({
      ...entry,
      evidence: ["path:tests/role-boundary.test.mjs", "command:failing:oracle"],
    }));
    writeFileSync(receiptPath, canonicalJson(receipt));

    const result = runMigrationChecker(fixture.root);
    assert.notEqual(result.status, 0, "a failing oracle must fail migration");
    assert.match(result.stderr, /rewrite oracle failed/u);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("CI policy fails closed on locally unscannable tracked bytes", () => {
  const fixture = createRepositoryFixture("roastery-secret-policy-");
  try {
    const cases = [
      {
        name: "over-limit text",
        bytes: Buffer.concat([
          Buffer.from(`sk-proj-${"a".repeat(40)}\n`),
          Buffer.alloc(1_000_001, 0x61),
        ]),
      },
      {
        name: "NUL-containing bytes",
        bytes: Buffer.from(`sk-proj-${"b".repeat(40)}\u0000tail`),
      },
    ];
    for (const scenario of cases) {
      writeFileSync(resolve(fixture.root, ".editorconfig"), scenario.bytes);
      const result = spawnSync(
        process.execPath,
        [resolve(fixture.root, ".github/ci-policy.mjs")],
        { cwd: fixture.root, encoding: "utf8" },
      );
      assert.notEqual(result.status, 0, `${scenario.name} must fail closed`);
      assert.match(result.stderr, /cannot inspect for secrets/u, scenario.name);
    }
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("official software and contract scope uses the fresh Openboa AI MIT license", () => {
  const expected = `MIT License

Copyright (c) 2026 Openboa AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
  assert.equal(readText("LICENSE"), expected);
});
