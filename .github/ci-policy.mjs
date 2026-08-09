import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowRoot = resolve(root, ".github/workflows");
const failures = [];

const actionPins = new Set([
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
  "github/codeql-action/init@c4dd10e44af883a891fe31ced449bcb4a6728b9b",
  "github/codeql-action/analyze@c4dd10e44af883a891fe31ced449bcb4a6728b9b",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  "actions/upload-code-coverage@1c15be36fc3733ba839b1dd643bd9556e4426dc1",
]);
const workflowNames = [
  "codeql.yml",
  "github-coverage.yml",
  "policy.yml",
  "quality.yml",
];
const ordinaryPermissions = { contents: "read" };
const codeqlPermissions = {
  actions: "read",
  contents: "read",
  "security-events": "write",
};
const coverageUploadPermissions = {
  "code-quality": "write",
  contents: "read",
};

function fail(message) {
  failures.push(message);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function sameRecord(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  const actualEntries = Object.entries(actual).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
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

function gitPaths(args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
    return [];
  }
  return result.stdout.split("\0").filter(Boolean);
}

function validateWorkflow(name, document) {
  const events = document.on;
  if (!events || typeof events !== "object" || Array.isArray(events)) {
    fail(`${name}: events must be an object`);
  } else {
    const expectedEvents =
      name === "codeql.yml" || name === "github-coverage.yml"
        ? ["merge_group", "pull_request", "push"]
        : ["merge_group", "pull_request"];
    if (
      JSON.stringify(Object.keys(events).sort()) !==
      JSON.stringify(expectedEvents)
    ) {
      fail(`${name}: required event set changed`);
    }
    for (const eventName of ["pull_request", "merge_group"]) {
      if (events[eventName] !== null) {
        fail(`${name}: ${eventName} must not contain path or branch filters`);
      }
    }
    if (
      (name === "codeql.yml" || name === "github-coverage.yml") &&
      JSON.stringify(events.push) !== JSON.stringify({ branches: ["main"] })
    ) {
      fail(`${name}: push analysis must target only main`);
    }
  }
  if (!sameRecord(document.permissions, {})) {
    fail(`${name}: workflow permissions must default to none`);
  }
  if (collectByKey(document, "continue-on-error").length > 0) {
    fail(`${name}: continue-on-error is forbidden`);
  }

  for (const use of collectByKey(document, "uses")) {
    if (typeof use !== "string" || !/^[^@\s]+@[0-9a-f]{40}$/u.test(use)) {
      fail(`${name}: every uses entry must be pinned to a full SHA: ${use}`);
    } else if (!actionPins.has(use)) {
      fail(`${name}: action pin is not approved: ${use}`);
    }
  }

  for (const [jobId, job] of Object.entries(document.jobs ?? {})) {
    const expected =
      name === "codeql.yml" && jobId === "analyze"
        ? codeqlPermissions
        : name === "github-coverage.yml" &&
            jobId === "upload-coverage-javascript"
          ? coverageUploadPermissions
          : ordinaryPermissions;
    if (!sameRecord(job.permissions, expected)) {
      fail(`${name}:${jobId}: permissions do not match the job class`);
    }
    for (const step of job.steps ?? []) {
      if (
        step.uses?.startsWith("actions/checkout@") &&
        step.with?.["persist-credentials"] !== false
      ) {
        fail(`${name}:${jobId}: checkout must disable persisted credentials`);
      }
      if (
        step.uses?.startsWith("actions/checkout@") &&
        ["github-coverage.yml", "policy.yml", "quality.yml"].includes(name) &&
        step.with?.["fetch-depth"] !== 0
      ) {
        fail(`${name}:${jobId}: required lanes must fetch complete history`);
      }
      if (
        step.uses?.startsWith("actions/setup-node@") &&
        String(step.with?.["node-version"]) !== "24"
      ) {
        fail(`${name}:${jobId}: setup-node must use Node 24`);
      }
    }
  }
}

const discoveredWorkflows = readdirSync(workflowRoot)
  .filter((name) => /\.ya?ml$/u.test(name))
  .sort();
if (JSON.stringify(discoveredWorkflows) !== JSON.stringify(workflowNames)) {
  fail(`workflow set must be exactly ${workflowNames.join(", ")}`);
}

const workflows = new Map();
for (const name of discoveredWorkflows) {
  try {
    const source = readFileSync(resolve(workflowRoot, name), "utf8");
    if (/\bpull_request_target\b/u.test(source)) {
      fail(`${name}: pull_request_target is forbidden`);
    }
    if (/\bsecrets\s*\./u.test(source)) {
      fail(`${name}: secret context is forbidden`);
    }
    if (/\|\|\s*true/u.test(source)) {
      fail(`${name}: shell success masking is forbidden`);
    }
    const document = parse(source);
    workflows.set(name, document);
    validateWorkflow(name, document);
  } catch (error) {
    fail(`${name}: cannot parse workflow: ${describeError(error)}`);
  }
}

const aggregateJobs = [];
for (const [name, workflow] of workflows) {
  for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
    if (jobId === "aggregate") aggregateJobs.push({ name, job });
  }
}
if (aggregateJobs.length !== 1) {
  fail("workflow set must expose exactly one aggregate job");
} else {
  const [{ name, job }] = aggregateJobs;
  if (name !== "quality.yml" || job.if !== "always()") {
    fail("quality.yml:aggregate must use if: always()");
  }
  if (!Array.isArray(job.needs) || job.needs.length === 0) {
    fail("quality.yml:aggregate must depend on internal lanes");
  }
  const aggregateSteps = JSON.stringify(job.steps ?? []);
  for (const marker of [
    "needs.",
    "failed",
    "invalid",
    "skipped",
    "unavailable",
  ]) {
    if (!aggregateSteps.includes(marker)) {
      fail(`quality.yml:aggregate must preserve ${marker}`);
    }
  }
}

const qualityRuns = (workflows.get("quality.yml")?.jobs?.quality?.steps ?? [])
  .filter((step) => typeof step.run === "string")
  .map((step) => step.run.trim());
const expectedQualityRuns = [
  "npm ci",
  "npm run format:check",
  "npm run typecheck",
  "npm test",
  "npm run ci:policy",
];
if (JSON.stringify(qualityRuns) !== JSON.stringify(expectedQualityRuns)) {
  fail("quality.yml: quality commands or order changed");
}

const policyRuns = (workflows.get("policy.yml")?.jobs?.policy?.steps ?? [])
  .filter((step) => typeof step.run === "string")
  .map((step) => step.run.trim());
if (
  JSON.stringify(policyRuns) !== JSON.stringify(["npm ci", "npm run ci:policy"])
) {
  fail("policy.yml: policy job must run only install and the policy checker");
}

const coverageWorkflow = workflows.get("github-coverage.yml");
const coverageJob = coverageWorkflow?.jobs?.coverage;
const coverageSteps = coverageJob?.steps ?? [];
const coverageCheckout = coverageSteps.find((step) =>
  String(step.uses).startsWith("actions/checkout@"),
);
if (
  coverageCheckout?.with?.ref !==
  "${{ github.event.pull_request.head.sha || github.sha }}"
) {
  fail("github-coverage.yml: checkout must bind the pull request head SHA");
}
const coverageRuns = coverageSteps
  .filter((step) => typeof step.run === "string")
  .map((step) => step.run);
if (
  !coverageRuns.some(
    (run) =>
      run.includes("--experimental-test-coverage") &&
      run.includes("tests/*.test.mjs"),
  )
) {
  fail("github-coverage.yml: coverage must execute the complete test suite");
}
if (
  !coverageRuns.some(
    (run) =>
      run.includes("--require-hashes") &&
      run.includes(".github/coverage-requirements.txt"),
  )
) {
  fail("github-coverage.yml: converter dependency must be hash locked");
}
const coverageArtifact = coverageSteps.find((step) =>
  String(step.uses).startsWith("actions/upload-artifact@"),
);
if (
  !String(coverageArtifact?.if).includes(
    "github.event.pull_request.head.repo.full_name == github.repository",
  ) ||
  coverageArtifact?.with?.["if-no-files-found"] !== "error" ||
  coverageArtifact?.with?.["retention-days"] !== 1
) {
  fail(
    "github-coverage.yml: coverage artifact must fail closed and reject forks",
  );
}
const coverageUploadJob =
  coverageWorkflow?.jobs?.["upload-coverage-javascript"];
const coverageUploadCondition = String(coverageUploadJob?.if);
if (
  coverageUploadJob?.needs !== "coverage" ||
  !coverageUploadCondition.includes("needs.coverage.result == 'success'") ||
  !coverageUploadCondition.includes("github.event_name != 'merge_group'") ||
  !coverageUploadCondition.includes(
    "github.event.pull_request.head.repo.full_name == github.repository",
  )
) {
  fail("github-coverage.yml: privileged upload boundary is invalid");
}
const coverageUploadStep = (coverageUploadJob?.steps ?? []).find((step) =>
  String(step.uses).startsWith("actions/upload-code-coverage@"),
);
if (
  !sameRecord(coverageUploadStep?.with, {
    file: "cobertura.xml",
    language: "JavaScript",
    label: "roastery-javascript",
  })
) {
  fail("github-coverage.yml: GitHub coverage upload contract changed");
}
try {
  const requirements = readFileSync(
    resolve(root, ".github/coverage-requirements.txt"),
    "utf8",
  );
  if (
    requirements !==
    "lcov_cobertura==2.1.1 --hash=sha256:92f8107297f6d1d7a7a0a88c6071c1ea04f862f2fe918c6ecce271573c37d8aa\n"
  ) {
    fail("coverage converter dependency or hash changed");
  }
} catch (error) {
  fail(
    `coverage converter requirements cannot be read: ${describeError(error)}`,
  );
}

const dependencySteps =
  workflows.get("policy.yml")?.jobs?.["dependency-review"]?.steps ?? [];
const mergeGroupDependencyStep = dependencySteps.find((step) =>
  String(step.if).includes("github.event_name == 'merge_group'"),
);
if (
  mergeGroupDependencyStep?.with?.["base-ref"] !==
    "${{ github.event.merge_group.base_sha }}" ||
  mergeGroupDependencyStep?.with?.["head-ref"] !==
    "${{ github.event.merge_group.head_sha }}"
) {
  fail("policy.yml: merge_group dependency review must bind base/head SHAs");
}

const codeqlSteps = workflows.get("codeql.yml")?.jobs?.analyze?.steps ?? [];
if (codeqlSteps.some((step) => typeof step.run === "string")) {
  fail("codeql.yml: analyze must not execute repository scripts");
}

let mergePolicy;
try {
  mergePolicy = JSON.parse(
    readFileSync(resolve(root, ".github/merge-policy.json"), "utf8"),
  );
} catch (error) {
  fail(`merge policy is invalid: ${describeError(error)}`);
}
if (mergePolicy) {
  if (
    mergePolicy.repository_role !== "roastery" ||
    mergePolicy.merge_method !== "squash" ||
    mergePolicy.auto_merge?.ordinary !== true ||
    mergePolicy.auto_merge?.protected_after_code_owner_approval !== true ||
    "protected" in mergePolicy.auto_merge
  ) {
    fail("merge policy does not describe the Roastery merge boundary");
  }
  if (
    JSON.stringify(mergePolicy.required_events) !==
    JSON.stringify(["merge_group", "pull_request"])
  ) {
    fail("merge policy required events changed");
  }
  const requiredProtectedPaths = [
    "/.github/**",
    "/AGENTS.md",
    "/CODEOWNERS",
    "/LICENSE",
    "/scripts/check-migration-receipt.mjs",
    "/docs/migration/**",
    "/contract/**",
    "/roastery/CONTENT_LICENSE.md",
  ];
  for (const path of requiredProtectedPaths) {
    if (!mergePolicy.protected_paths?.includes(path)) {
      fail(`merge policy is missing protected path ${path}`);
    }
  }

  const checker = mergePolicy.migration?.checker;
  const base = mergePolicy.migration?.base_commit;
  const target = mergePolicy.migration?.target_commit;
  if (
    checker !== "scripts/check-migration-receipt.mjs" ||
    !/^[0-9a-f]{40}$/u.test(base ?? "") ||
    !/^[0-9a-f]{40}$/u.test(target ?? "")
  ) {
    fail("merge policy migration checker contract is invalid");
  } else {
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, checker),
        "--root",
        root,
        "--base",
        base,
        "--target",
        target,
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      fail(
        `migration checker failed: ${(result.stderr || result.stdout).trim()}`,
      );
    }
  }
}

const trackedPaths = gitPaths(["ls-files", "-z"]);
for (const path of trackedPaths) {
  if (/(?:^|\/)(?:node_modules|dist|coverage)(?:\/|$)/u.test(path)) {
    fail(`generated or dependency path is tracked: ${path}`);
  }
}

const repositoryPaths = gitPaths([
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
]);
const foreignSurfaces = [
  ".agents/plugins/",
  ".codex-plugin/",
  "plugin.json",
  "skills/",
  "runtime/",
  "src/runtime/",
  "src/release/",
  "eval/",
  "benchmark/",
  "tasks/",
  "datasets/",
  "metrics/",
  "verifiers/",
];
for (const path of repositoryPaths) {
  if (
    foreignSurfaces.some(
      (surface) => path === surface || path.startsWith(surface),
    )
  ) {
    fail(`foreign repository surface is forbidden: ${path}`);
  }
}

/** @type {Array<[string, RegExp]>} */
const secretPatterns = [
  [
    "private key",
    new RegExp(
      ["-{5}BEGIN ", "(?:RSA |EC |OPENSSH |DSA )?", "PRIVATE KEY-{5}"].join(""),
      "u",
    ),
  ],
  [
    "GitHub token",
    new RegExp(["gh", "[pousr]_", "[A-Za-z0-9_]{36,}"].join(""), "u"),
  ],
  ["AWS access key", new RegExp(["AK", "IA", "[0-9A-Z]{16}"].join(""), "u")],
  [
    "OpenAI key",
    new RegExp(["s", "k-(?:proj-)?", "[A-Za-z0-9_-]{32,}"].join(""), "u"),
  ],
  [
    "assigned secret",
    /(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}/iu,
  ],
];
for (const path of repositoryPaths) {
  const absolutePath = resolve(root, path);
  let source;
  try {
    if (!statSync(absolutePath).isFile()) continue;
    const bytes = readFileSync(absolutePath);
    if (bytes.length > 1_000_000) {
      fail(`${path}: cannot inspect for secrets: file exceeds 1,000,000 bytes`);
      continue;
    }
    if (bytes.includes(0)) {
      fail(`${path}: cannot inspect for secrets: file contains NUL bytes`);
      continue;
    }
    source = bytes.toString("utf8");
  } catch (error) {
    fail(`${path}: cannot inspect repository file: ${describeError(error)}`);
    continue;
  }
  for (const [name, pattern] of secretPatterns) {
    if (pattern.test(source)) fail(`${path}: detected common ${name} pattern`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Roastery CI policy passed.");
}
