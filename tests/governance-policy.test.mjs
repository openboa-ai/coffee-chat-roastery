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
const protectedContractBase = "373e0525e12d5525441504d665bf5980e1484858";
const workflowPaths = [
  ".github/workflows/policy.yml",
  ".github/workflows/quality.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/github-coverage.yml",
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

function assertTrustedAuthorGate(step, label) {
  assert.ok(step, `${label}: trusted-author gate must exist`);
  assert.equal(step.name, "Verify trusted pull request author", label);
  assert.equal(step.if, "github.event_name == 'pull_request'", label);
  assert.deepEqual(
    step.env,
    {
      AUTHOR_ASSOCIATION: "${{ github.event.pull_request.author_association }}",
      PR_AUTHOR_LOGIN: "${{ github.event.pull_request.user.login }}",
    },
    label,
  );

  for (const scenario of [
    { association: "OWNER", login: "someone", accepted: true },
    { association: "MEMBER", login: "someone", accepted: true },
    { association: "CONTRIBUTOR", login: "openboa", accepted: true },
    { association: "NONE", login: "openboa", accepted: true },
    { association: "CONTRIBUTOR", login: "someone", accepted: false },
    { association: "NONE", login: "Openboa", accepted: false },
  ]) {
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", step.run], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        AUTHOR_ASSOCIATION: scenario.association,
        PR_AUTHOR_LOGIN: scenario.login,
      },
    });
    assert.equal(
      result.status === 0,
      scenario.accepted,
      `${label}: ${scenario.association}/${scenario.login}`,
    );
  }
}

test("required workflows expose safe, always-created pull request evidence", () => {
  const entries = workflowEntries();
  const aggregateJobs = [];

  for (const { path, bytes, document } of entries) {
    assert.equal(typeof document, "object", `${path} must parse as YAML`);
    assert.ok(document.on?.pull_request !== undefined, `${path}: pull_request`);
    assert.ok(document.on?.merge_group !== undefined, `${path}: merge_group`);
    const expectedPullRequest = path.endsWith("quality.yml")
      ? { types: ["opened", "synchronize", "reopened", "edited"] }
      : null;
    assert.deepEqual(
      document.on.pull_request,
      expectedPullRequest,
      `${path}: pull_request activity contract`,
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
          : path.endsWith("github-coverage.yml") &&
              jobId === "upload-coverage-javascript"
            ? {
                "code-quality": "write",
                contents: "read",
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

test("author eligibility gates every candidate-executing quality lane", () => {
  const workflow = parse(readText(".github/workflows/quality.yml"));
  const eligibility = workflow.jobs.eligibility;

  assert.ok(eligibility, "eligibility job must exist before candidate lanes");
  assert.equal(
    collectByKey(eligibility, "uses").length,
    0,
    "eligibility must not check out or invoke an Action from the candidate",
  );
  assert.doesNotMatch(
    JSON.stringify(collectByKey(eligibility, "run")),
    /\b(?:git|node|npm|npx)\b/u,
    "eligibility must not execute repository tooling",
  );

  const mergeGroupStep = eligibility.steps.find(
    (candidate) => candidate.name === "Admit merge queue candidate",
  );
  assert.equal(mergeGroupStep.if, "github.event_name == 'merge_group'");
  const mergeGroupResult = spawnSync(
    "bash",
    ["-euo", "pipefail", "-c", mergeGroupStep.run],
    { cwd: root, encoding: "utf8", env: process.env },
  );
  assert.equal(mergeGroupResult.status, 0, mergeGroupResult.stderr);

  const step = eligibility.steps.find(
    (candidate) => candidate.name === "Verify trusted pull request author",
  );
  assertTrustedAuthorGate(step, "quality.yml:eligibility");

  const candidateJobs = Object.entries(workflow.jobs).filter(
    ([jobId, job]) =>
      !["aggregate", "eligibility"].includes(jobId) &&
      (collectByKey(job.steps, "uses").some((use) =>
        String(use).startsWith("actions/checkout@"),
      ) ||
        collectByKey(job.steps, "run").some((run) =>
          /\b(?:node|npm|npx)\b/u.test(String(run)),
        )),
  );
  assert.deepEqual(
    candidateJobs.map(([jobId]) => jobId),
    ["quality", "publication", "contract-refresh"],
  );
  for (const [jobId, job] of candidateJobs) {
    const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
    assert.ok(
      needs.includes("eligibility"),
      `${jobId} must wait for author eligibility`,
    );
    if (job.if !== undefined) {
      assert.match(
        String(job.if),
        /needs\.eligibility\.result == 'success'/u,
        `${jobId} must not bypass a failed eligibility dependency`,
      );
    }
  }

  const aggregate = workflow.jobs.aggregate;
  assert.deepEqual(aggregate.needs, [
    "eligibility",
    "quality",
    "publication",
    "contract-refresh",
  ]);
  const interpreter = aggregate.steps.find(
    (candidate) => candidate.name === "Interpret required lane state",
  );
  assert.deepEqual(interpreter.env, {
    CONTRACT_REFRESH_RESULT: "${{ needs.contract-refresh.result }}",
    ELIGIBILITY_RESULT: "${{ needs.eligibility.result }}",
    PUBLICATION_RESULT: "${{ needs.publication.result }}",
    QUALITY_RESULT: "${{ needs.quality.result }}",
  });
  const rejected = spawnSync(
    "bash",
    ["-euo", "pipefail", "-c", interpreter.run],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CONTRACT_REFRESH_RESULT: "skipped",
        ELIGIBILITY_RESULT: "failure",
        PUBLICATION_RESULT: "skipped",
        QUALITY_RESULT: "skipped",
      },
    },
  );
  assert.notEqual(rejected.status, 0, "ineligible authors must fail required");
  assert.match(rejected.stderr, /eligibility=failed/u);
});

test("policy and coverage gate pull requests before candidate execution", () => {
  for (const { path, jobId } of [
    { path: ".github/workflows/policy.yml", jobId: "policy" },
    { path: ".github/workflows/github-coverage.yml", jobId: "coverage" },
  ]) {
    const workflow = parse(readText(path));
    const job = workflow.jobs[jobId];
    const gate = job.steps[0];

    assertTrustedAuthorGate(gate, `${path}:${jobId}`);
    assert.equal(
      job.if,
      undefined,
      `${path}:${jobId} must continue on push or merge_group`,
    );
    const firstCandidateExecution = job.steps.findIndex(
      (step) =>
        String(step.uses).startsWith("actions/checkout@") ||
        /\b(?:node|npm|npx)\b/u.test(String(step.run)),
    );
    assert.ok(firstCandidateExecution > 0, `${path}:${jobId} gate ordering`);
  }

  const policy = parse(readText(".github/workflows/policy.yml"));
  assert.equal(
    policy.jobs["dependency-review"].steps.some(
      (step) => step.name === "Verify trusted pull request author",
    ),
    false,
    "dependency review does not run repository scripts",
  );

  const codeql = parse(readText(".github/workflows/codeql.yml"));
  assert.equal(
    codeql.jobs.analyze.steps.some(
      (step) => step.name === "Verify trusted pull request author",
    ),
    false,
    "CodeQL no-build analysis does not run repository scripts",
  );
  assert.equal(collectByKey(codeql.jobs.analyze.steps, "run").length, 0);
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
    ".github/workflows/github-coverage.yml",
  ]) {
    const document = parse(readText(path));
    const checkoutSteps = collectByKey(document.jobs, "uses")
      .map((use, index) => ({ use, index }))
      .filter(({ use }) => String(use).startsWith("actions/checkout@"));
    assert.ok(checkoutSteps.length >= 1, `${path}: checkout cardinality`);
    const checkouts = Object.values(document.jobs ?? {})
      .flatMap((job) => job.steps ?? [])
      .filter((step) => String(step.uses).startsWith("actions/checkout@"));
    for (const checkout of checkouts) {
      assert.equal(checkout.with?.["fetch-depth"], 0, path);
    }
  }
});

test("publication and contract-refresh lanes execute acceptance and preserve the receipt", () => {
  const workflow = parse(readText(".github/workflows/quality.yml"));
  const publication = workflow.jobs.publication;
  const refresh = workflow.jobs["contract-refresh"];
  const aggregate = workflow.jobs.aggregate;

  assert.ok(publication, "publication lane must exist");
  assert.ok(refresh, "contract-refresh lane must exist");
  assert.deepEqual(workflow.on.pull_request.types, [
    "opened",
    "synchronize",
    "reopened",
    "edited",
  ]);
  assert.deepEqual(aggregate.needs, [
    "eligibility",
    "quality",
    "publication",
    "contract-refresh",
  ]);
  assert.ok(
    publication.steps.some((step) => step.run === "npm run test:publication"),
  );
  assert.ok(
    publication.steps.some((step) => step.run === "npm run check:publication"),
  );
  const publicationCheckout = publication.steps.find((step) =>
    String(step.uses).startsWith("actions/checkout@"),
  );
  assert.equal(
    publicationCheckout?.with?.ref,
    "${{ github.event.pull_request.head.sha || github.sha }}",
  );
  const publicationEnforcement = publication.steps.find(
    (step) => step.run === "npm run check:publication",
  );
  assert.deepEqual(publicationEnforcement?.env, {
    ROASTERY_TRUSTED_CONTRACT_REPOSITORY:
      "${{ vars.ROASTERY_TRUSTED_CONTRACT_REPOSITORY }}",
    ROASTERY_TRUSTED_CONTRACT_COMMIT:
      "${{ vars.ROASTERY_TRUSTED_CONTRACT_COMMIT }}",
    ROASTERY_TRUSTED_CONTRACT_DIGEST:
      "${{ vars.ROASTERY_TRUSTED_CONTRACT_DIGEST }}",
  });
  assert.ok(
    refresh.steps.some((step) => step.run === "npm run test:contract-refresh"),
  );
  const acceptance = refresh.steps.find(
    (step) => step.run === "npm run test:contract-refresh",
  );
  assert.equal(
    acceptance?.env?.CONTRACT_REFRESH_EVIDENCE_OUTPUT,
    "artifacts/contract-refresh-evidence.json",
  );
  const evidenceArtifact = refresh.steps.find(
    (step) => step.id === "upload-contract-refresh-evidence",
  );
  assert.equal(evidenceArtifact?.with?.name, "contract-refresh-evidence");
  assert.equal(
    evidenceArtifact?.with?.path,
    "artifacts/contract-refresh-evidence.json",
  );
  assert.equal(evidenceArtifact?.with?.["if-no-files-found"], "error");
  assert.equal(evidenceArtifact?.with?.["retention-days"], 90);
  const buildReceipt = refresh.steps.find(
    (step) => step.run === "npm run build:contract-refresh-receipt",
  );
  assert.deepEqual(buildReceipt?.env, {
    CONTRACT_REFRESH_EVIDENCE_ARTIFACT_DIGEST:
      "${{ steps.upload-contract-refresh-evidence.outputs.artifact-digest }}",
    CONTRACT_REFRESH_EVIDENCE_ARTIFACT_ID:
      "${{ steps.upload-contract-refresh-evidence.outputs.artifact-id }}",
    CONTRACT_REFRESH_EVIDENCE_ARTIFACT_URL:
      "${{ steps.upload-contract-refresh-evidence.outputs.artifact-url }}",
    CONTRACT_REFRESH_EVIDENCE_PATH: "artifacts/contract-refresh-evidence.json",
    CONTRACT_REFRESH_RECEIPT_OUTPUT: "artifacts/contract-refresh-receipt.json",
    GITHUB_RUN_URL:
      "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
  });
  const artifact = refresh.steps.find(
    (step) => step.id === "upload-contract-refresh-receipt",
  );
  assert.equal(artifact?.with?.name, "contract-refresh-receipt");
  assert.equal(artifact?.with?.["if-no-files-found"], "error");
  assert.equal(artifact?.with?.["retention-days"], 90);
  assert.equal(artifact?.with?.path, "artifacts/contract-refresh-receipt.json");
});

test("coverage evidence fails closed before same-repository upload", () => {
  const path = ".github/workflows/github-coverage.yml";
  const bytes = readText(path);
  const workflow = parse(bytes);
  const coverage = workflow.jobs.coverage;
  const upload = workflow.jobs["upload-coverage-javascript"];
  const checkout = coverage.steps.find((step) =>
    String(step.uses).startsWith("actions/checkout@"),
  );
  const artifact = coverage.steps.find((step) =>
    String(step.uses).startsWith("actions/upload-artifact@"),
  );
  const uploadStep = upload.steps.find((step) =>
    String(step.uses).startsWith("actions/upload-code-coverage@"),
  );

  assert.doesNotMatch(bytes, /\|\|\s*true/u, "test failures stay failures");
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.equal(
    checkout.with.ref,
    "${{ github.event.pull_request.head.sha || github.sha }}",
  );
  assert.match(
    bytes,
    /--require-hashes[\s\S]*\.github\/coverage-requirements\.txt/u,
  );
  assert.match(
    readText(".github/coverage-requirements.txt"),
    /^lcov_cobertura==2\.1\.1 --hash=sha256:[0-9a-f]{64}\n$/u,
  );
  assert.match(
    String(artifact.if),
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u,
  );
  assert.equal(artifact.with["if-no-files-found"], "error");
  assert.equal(artifact.with["retention-days"], 1);
  assert.equal(upload.needs, "coverage");
  assert.match(String(upload.if), /needs\.coverage\.result == 'success'/u);
  assert.match(String(upload.if), /github\.event_name != 'merge_group'/u);
  assert.match(
    String(upload.if),
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u,
  );
  assert.deepEqual(upload.permissions, {
    "code-quality": "write",
    contents: "read",
  });
  assert.deepEqual(uploadStep.with, {
    file: "cobertura.xml",
    language: "JavaScript",
    label: "roastery-javascript",
  });
});

test("merge policy uses trusted-author auto-merge with ownership routing", () => {
  const policy = readJson(".github/merge-policy.json");
  assert.equal(policy.repository_role, "roastery");
  assert.equal(policy.merge_method, "squash");
  assert.deepEqual(policy.auto_merge, {
    required_checks: true,
    verified_members_only: true,
  });
  assert.deepEqual(policy.eligible_author_associations, ["OWNER", "MEMBER"]);
  assert.deepEqual(policy.eligible_author_logins, ["openboa"]);
  assert.deepEqual(policy.required_events, ["merge_group", "pull_request"]);
  assert.deepEqual(policy.required_checks, [
    { context: "Roastery required", integration_id: 15368 },
    { context: "Roastery dependency review", integration_id: 15368 },
  ]);

  for (const protectedPath of [
    "/tsconfig.json",
    "/src/cli.ts",
    "/tests/content-license-contract.test.ts",
    "/tests/contract.test.ts",
    "/tests/rights-semantics-contract.test.ts",
    "/tests/publication-acceptance.test.ts",
    "/tests/contract-refresh-acceptance.test.ts",
    "/tests/security-boundary.test.ts",
    "/tests/validator.test.ts",
    "/tests/helpers/**",
    "/scripts/build-contract-refresh-receipt.mjs",
    "/scripts/check-publication.mjs",
  ]) {
    assert.ok(
      policy.protected_paths.includes(protectedPath),
      `missing protected contract path: ${protectedPath}`,
    );
  }

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
        `^${protectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+@openboa$`,
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

test("migration evidence is recomputed for the protected contract milestone", () => {
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, "scripts/check-migration-receipt.mjs"),
      "--root",
      root,
      "--base",
      protectedContractBase,
      "--projection",
      resolve(
        root,
        "docs/migration/selections/task-5-protected-roastery-contract.json",
      ),
      "--equality",
      resolve(
        root,
        "docs/migration/equality/task-5-protected-roastery-contract.json",
      ),
      "--receipt",
      resolve(
        root,
        "docs/migration/receipts/task-5-protected-roastery-contract.json",
      ),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.target_commit, null);
  assert.equal(evidence.selected_rows, 1);
  assert.ok(evidence.changed_surfaces > 40);
});

test("CI rejects later surfaces without a scoped migration milestone", () => {
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
    assert.notEqual(result.status, 0, "unclassified later work must fail");
    assert.match(result.stderr, /active migration checker failed/u);
    assert.match(result.stderr, /changed surfaces mismatch/u);
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
