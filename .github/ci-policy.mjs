import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowRoot = resolve(root, ".github/workflows");
const failures = [];
const workflowNames = ["codeql.yml", "policy.yml", "quality.yml"];
const actionPins = new Set([
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  "actions/upload-code-coverage@1c15be36fc3733ba839b1dd643bd9556e4426dc1",
  "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
  "github/codeql-action/init@c4dd10e44af883a891fe31ced449bcb4a6728b9b",
  "github/codeql-action/analyze@c4dd10e44af883a891fe31ced449bcb4a6728b9b",
]);
const ordinaryPermissions = { contents: "read" };
const codeqlPermissions = {
  actions: "read",
  contents: "read",
  "security-events": "write",
};
const coveragePermissions = { contents: "read", "code-quality": "write" };

function fail(message) {
  failures.push(message);
}

function sameRecord(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  return (
    JSON.stringify(Object.entries(actual).sort()) ===
    JSON.stringify(Object.entries(expected).sort())
  );
}

function collectByKey(value, key, found = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectByKey(entry, key, found);
  } else if (value && typeof value === "object") {
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (entryKey === key) found.push(entryValue);
      collectByKey(entryValue, key, found);
    }
  }
  return found;
}

function runs(job) {
  return (job?.steps ?? [])
    .filter((step) => typeof step.run === "string")
    .map((step) => step.run.trim());
}

function validateEvents(name, events) {
  const expected =
    name === "codeql.yml"
      ? ["merge_group", "pull_request", "push"]
      : ["merge_group", "pull_request"];
  if (
    !events ||
    typeof events !== "object" ||
    Array.isArray(events) ||
    JSON.stringify(Object.keys(events).sort()) !== JSON.stringify(expected)
  ) {
    fail(`${name}: event set changed`);
    return;
  }
  if (events.merge_group !== null) {
    fail(`${name}: merge_group filters are forbidden`);
  }
  const expectedPullRequest =
    name === "quality.yml"
      ? { types: ["opened", "synchronize", "reopened", "edited"] }
      : null;
  if (
    JSON.stringify(events.pull_request) !== JSON.stringify(expectedPullRequest)
  ) {
    fail(`${name}: pull_request activity contract changed`);
  }
  if (
    name === "codeql.yml" &&
    JSON.stringify(events.push) !== JSON.stringify({ branches: ["main"] })
  ) {
    fail("codeql.yml: push analysis must target main");
  }
}

function validateWorkflow(name, source, document) {
  validateEvents(name, document.on);
  if (!sameRecord(document.permissions, {})) {
    fail(`${name}: workflow permissions must default to none`);
  }
  if (/\bpull_request_target\b/u.test(source)) {
    fail(`${name}: pull_request_target is forbidden`);
  }
  if (/\bsecrets\s*\./u.test(source)) {
    fail(`${name}: secret context is forbidden`);
  }
  if (/\|\|\s*true/u.test(source)) {
    fail(`${name}: shell success masking is forbidden`);
  }
  if (collectByKey(document, "continue-on-error").length > 0) {
    fail(`${name}: continue-on-error is forbidden`);
  }

  for (const use of collectByKey(document, "uses")) {
    if (typeof use !== "string" || !/^[^@\s]+@[0-9a-f]{40}$/u.test(use)) {
      fail(`${name}: action is not pinned to a full SHA: ${use}`);
    } else if (!actionPins.has(use)) {
      fail(`${name}: action pin is not approved: ${use}`);
    }
  }

  for (const [jobId, job] of Object.entries(document.jobs ?? {})) {
    const expectedPermissions =
      name === "codeql.yml" && jobId === "analyze"
        ? codeqlPermissions
        : name === "quality.yml" && jobId === "upload-coverage"
          ? coveragePermissions
          : ordinaryPermissions;
    if (!sameRecord(job.permissions, expectedPermissions)) {
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
        step.uses?.startsWith("actions/setup-node@") &&
        String(step.with?.["node-version"]) !== "24"
      ) {
        fail(`${name}:${jobId}: Node 24 is required`);
      }
    }
  }
}

const discovered = readdirSync(workflowRoot)
  .filter((name) => /\.ya?ml$/u.test(name))
  .sort();
if (JSON.stringify(discovered) !== JSON.stringify(workflowNames)) {
  fail(`workflow set must be exactly ${workflowNames.join(", ")}`);
}

const workflows = new Map();
for (const name of discovered) {
  try {
    const source = readFileSync(resolve(workflowRoot, name), "utf8");
    const document = parse(source);
    workflows.set(name, document);
    validateWorkflow(name, source, document);
  } catch (error) {
    fail(`${name}: cannot parse workflow: ${String(error)}`);
  }
}

const quality = workflows.get("quality.yml");
if (
  JSON.stringify(Object.keys(quality?.jobs ?? {}).sort()) !==
  JSON.stringify([
    "aggregate",
    "eligibility",
    "publication",
    "quality",
    "upload-coverage",
  ])
) {
  fail("quality.yml: job set changed");
}
const eligibility = quality?.jobs?.eligibility;
if (
  collectByKey(eligibility, "uses").length !== 0 ||
  collectByKey(eligibility, "run").some((run) =>
    /\b(?:git|node|npm|npx)\b/u.test(String(run)),
  )
) {
  fail("quality.yml: eligibility may not execute candidate content");
}
const authorStep = eligibility?.steps?.find(
  (step) => step.name === "Decide author eligibility",
);
if (
  !sameRecord(authorStep?.env, {
    AUTHOR_ASSOCIATION: "${{ github.event.pull_request.author_association }}",
    EVENT_NAME: "${{ github.event_name }}",
  })
) {
  fail("quality.yml: author eligibility metadata surface changed");
}

for (const jobId of ["quality", "publication"]) {
  if (quality?.jobs?.[jobId]?.needs !== "eligibility") {
    fail(`quality.yml:${jobId}: author eligibility is required`);
  }
}
if (
  JSON.stringify(runs(quality?.jobs?.quality)) !==
  JSON.stringify([
    "npm ci",
    "npm run format:check",
    "npm run typecheck",
    "npm run package:check",
    "npm run test:coverage",
    "npm run ci:policy",
  ])
) {
  fail("quality.yml: deterministic quality command set changed");
}
const coverageUpload = quality?.jobs?.["upload-coverage"];
if (
  coverageUpload?.needs !== "quality" ||
  !sameRecord(coverageUpload?.permissions, coveragePermissions) ||
  runs(coverageUpload).length !== 0
) {
  fail("quality.yml: coverage upload authority changed");
}
if (
  JSON.stringify(runs(quality?.jobs?.publication)) !==
  JSON.stringify([
    "npm ci",
    "npm run test:publication",
    "npm run check:publication",
  ])
) {
  fail("quality.yml: publication command set changed");
}
const publicationCheckout = quality?.jobs?.publication?.steps?.find((step) =>
  String(step.uses).startsWith("actions/checkout@"),
);
if (
  publicationCheckout?.with?.ref !==
    "${{ github.event.pull_request.head.sha || github.sha }}" ||
  publicationCheckout?.with?.["fetch-depth"] !== 0
) {
  fail(
    "quality.yml: publication must inspect the exact event head and history",
  );
}
const publicationCheck = quality?.jobs?.publication?.steps?.find(
  (step) => step.run === "npm run check:publication",
);
if (
  !sameRecord(publicationCheck?.env, {
    ROASTERY_TRUSTED_CONTRACT_COMMIT:
      "${{ vars.ROASTERY_TRUSTED_CONTRACT_COMMIT }}",
    ROASTERY_TRUSTED_CONTRACT_DIGEST:
      "${{ vars.ROASTERY_TRUSTED_CONTRACT_DIGEST }}",
    ROASTERY_TRUSTED_CONTRACT_REPOSITORY:
      "${{ vars.ROASTERY_TRUSTED_CONTRACT_REPOSITORY }}",
  })
) {
  fail("quality.yml: publication trust tuple must be repository-owned");
}

const aggregate = quality?.jobs?.aggregate;
if (
  aggregate?.if !== "always()" ||
  JSON.stringify(aggregate?.needs) !==
    JSON.stringify(["eligibility", "quality", "publication"])
) {
  fail("quality.yml: aggregate dependency set changed");
}
const aggregateSource = JSON.stringify(aggregate?.steps ?? []);
for (const state of ["failed", "invalid", "skipped", "unavailable"]) {
  if (!aggregateSource.includes(state)) {
    fail(`quality.yml: aggregate must preserve ${state}`);
  }
}

const policy = workflows.get("policy.yml");
if (
  JSON.stringify(Object.keys(policy?.jobs ?? {})) !==
  JSON.stringify(["dependency-review"])
) {
  fail("policy.yml: dependency review must be the only supply-chain job");
}

const mergePolicy = JSON.parse(
  readFileSync(resolve(root, ".github/merge-policy.json"), "utf8"),
);
if (
  mergePolicy.repository_role !== "roastery" ||
  mergePolicy.merge_method !== "squash" ||
  mergePolicy.auto_merge !== "github-native" ||
  JSON.stringify(mergePolicy.required_events) !==
    JSON.stringify(["merge_group", "pull_request"]) ||
  JSON.stringify(mergePolicy.eligible_author_associations) !==
    JSON.stringify(["OWNER", "MEMBER"]) ||
  !sameRecord(mergePolicy.review_policy, {
    required_approvals: 0,
    code_owner_reviews_required: false,
  })
) {
  fail("merge policy does not match GitHub-native squash authority");
}
if (
  JSON.stringify(mergePolicy.required_checks?.map((entry) => entry.context)) !==
  JSON.stringify(["Roastery required", "Roastery dependency review"])
) {
  fail("merge policy required check set changed");
}

const requiredScripts = [
  "build",
  "check:publication",
  "ci:policy",
  "format:check",
  "package:check",
  "prepack",
  "test",
  "test:coverage",
  "test:governance",
  "test:publication",
  "test:roastery",
  "typecheck",
];
const packageDocument = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
if (
  JSON.stringify(Object.keys(packageDocument.scripts ?? {}).sort()) !==
  JSON.stringify(requiredScripts)
) {
  fail("package script surface changed");
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("CI policy passed\n");
}
