import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const root = resolve(
  process.env.ROASTERY_CI_POLICY_ROOT ??
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const workflowRoot = resolve(root, ".github/workflows");
const failures = [];
const workflowNames = [
  "codeql.yml",
  "policy.yml",
  "quality.yml",
  "secret-boundary.yml",
];
const pinnedActions = new Set([
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "github/codeql-action/analyze@5595ccaf912efad79be6eef63a5619ff05969be3",
  "github/codeql-action/init@5595ccaf912efad79be6eef63a5619ff05969be3",
]);
const candidateWorkflows = new Set(["codeql.yml", "policy.yml", "quality.yml"]);
const requiredCommands = [
  "npm run format:check",
  "npm run typecheck",
  "npm run build",
  "npm run repository:check",
  "npm run smoke",
  "npm run package:check",
  "npm run ci:policy",
];
const authorEligibilityGate = `case "$EVENT_NAME" in
  merge_group) exit 0 ;;
  pull_request)
    case "$AUTHOR_ASSOCIATION" in OWNER|MEMBER) exit 0 ;; *) exit 1 ;; esac
    ;;
  *) exit 1 ;;
esac
`;

function fail(message) {
  failures.push(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function equal(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function getSteps(job) {
  return Array.isArray(job?.steps) ? job.steps : [];
}

function stepRuns(steps, command) {
  return steps.some((step) => isRecord(step) && step.run === command);
}

function indexOfRun(steps, command) {
  return steps.findIndex((step) => isRecord(step) && step.run === command);
}

function collectUses(value, uses = [], seen = new WeakSet()) {
  if (!value || typeof value !== "object") return uses;
  if (seen.has(value)) return uses;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectUses(item, uses, seen);
    return uses;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "uses") uses.push(item);
    collectUses(item, uses, seen);
  }
  return uses;
}

function collectStrings(value, strings = [], seen = new WeakSet()) {
  if (typeof value === "string") {
    strings.push(value);
    return strings;
  }
  if (!value || typeof value !== "object") return strings;
  if (seen.has(value)) return strings;
  seen.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    collectStrings(item, strings, seen);
  }
  return strings;
}

function requireWorkflowShape(name, workflow) {
  if (
    !isRecord(workflow) ||
    !hasExactKeys(workflow, ["name", "on", "permissions", "jobs"])
  ) {
    fail(`${name}: workflow shape`);
    return;
  }
  if (!isRecord(workflow.jobs)) {
    fail(`${name}: jobs mapping`);
    return;
  }
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (
      !isRecord(job) ||
      !Number.isInteger(job["timeout-minutes"]) ||
      job["timeout-minutes"] !== 15
    ) {
      fail(`${name}: ${jobName} timeout-minutes must be 15`);
    }
  }
}

function validateActions(name, workflow) {
  for (const action of collectUses(workflow)) {
    if (typeof action !== "string" || !pinnedActions.has(action)) {
      fail(`${name}: unapproved action ${String(action)}`);
    }
  }
  for (const job of Object.values(workflow.jobs ?? {})) {
    for (const step of getSteps(job)) {
      if (
        isRecord(step) &&
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/checkout@") &&
        step.with?.["persist-credentials"] !== false
      ) {
        fail(`${name}: checkout persists credentials`);
      }
    }
  }
}

function validateCandidateWorkflow(name, workflow) {
  if (!hasExactKeys(workflow.on, ["pull_request", "merge_group"])) {
    fail(`${name}: approved triggers`);
  }
  if (!hasExactKeys(workflow.permissions, [])) {
    fail(`${name}: root permissions must be empty`);
  }
  if (collectStrings(workflow).some((value) => value.includes("secrets."))) {
    fail(`${name}: secret context`);
  }
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    if (name === "codeql.yml" && jobName === "analyze") continue;
    if (
      !isRecord(job.permissions) ||
      Object.values(job.permissions).some((access) => access !== "read")
    ) {
      fail(`${name}: job permissions must be read-only`);
      break;
    }
  }
}

function validateCodeql(workflow) {
  const analyze = workflow.jobs?.analyze;
  if (!hasExactKeys(workflow.jobs, ["analyze"])) fail("codeql.yml: exact jobs");
  if (
    !isRecord(analyze) ||
    analyze.name !== "Roastery CodeQL JavaScript-TypeScript" ||
    analyze["runs-on"] !== "ubuntu-24.04" ||
    !equal(analyze.permissions, {
      contents: "read",
      actions: "read",
      "security-events": "write",
    })
  ) {
    fail("codeql.yml: CodeQL job permissions");
  }
  const steps = getSteps(analyze);
  if (
    steps[0]?.uses !==
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1" ||
    steps[1]?.uses !==
      "github/codeql-action/init@5595ccaf912efad79be6eef63a5619ff05969be3" ||
    steps[1]?.with?.languages !== "javascript-typescript" ||
    steps[1]?.with?.["build-mode"] !== "none" ||
    steps[2]?.uses !==
      "github/codeql-action/analyze@5595ccaf912efad79be6eef63a5619ff05969be3"
  ) {
    fail("codeql.yml: exact CodeQL actions");
  }
}

function validateDependencyReview(workflow) {
  const review = workflow.jobs?.["dependency-review"];
  if (!hasExactKeys(workflow.jobs, ["dependency-review"]))
    fail("policy.yml: exact jobs");
  if (
    !isRecord(review) ||
    review.name !== "Roastery dependency review" ||
    review["runs-on"] !== "ubuntu-24.04" ||
    !equal(review.permissions, { contents: "read" })
  ) {
    fail("policy.yml: dependency-review permissions");
  }
  const expectedAction =
    "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294";
  const [pullRequest, mergeGroup] = getSteps(review);
  for (const step of [pullRequest, mergeGroup]) {
    if (
      !isRecord(step) ||
      step.uses !== expectedAction ||
      step.with?.["fail-on-severity"] !== "moderate" ||
      step.with?.["fail-on-scopes"] !== "runtime,development,unknown" ||
      step.with?.["show-patched-versions"] !== true ||
      step.with?.["comment-summary-in-pr"] !== "never"
    ) {
      fail("policy.yml: dependency-review inputs");
      break;
    }
  }
  if (
    pullRequest?.if !== "github.event_name == 'pull_request'" ||
    mergeGroup?.if !== "github.event_name == 'merge_group'" ||
    mergeGroup?.with?.["base-ref"] !==
      "${{ github.event.merge_group.base_sha }}" ||
    mergeGroup?.with?.["head-ref"] !==
      "${{ github.event.merge_group.head_sha }}"
  ) {
    fail("policy.yml: exact merge-group refs");
  }
}

function validateQuality(workflow) {
  const { eligibility, quality, aggregate } = workflow.jobs ?? {};
  if (!hasExactKeys(workflow.jobs, ["eligibility", "quality", "aggregate"])) {
    fail("quality.yml: exact jobs");
  }
  if (
    !isRecord(eligibility) ||
    eligibility.name !== "Roastery author eligibility" ||
    !equal(eligibility.permissions, { contents: "read" }) ||
    !stepRuns(getSteps(eligibility), authorEligibilityGate)
  ) {
    fail("quality.yml: OWNER|MEMBER author gate");
  }
  if (
    !isRecord(quality) ||
    quality.name !== "Roastery deterministic quality" ||
    quality.needs !== "eligibility" ||
    !equal(quality.permissions, { contents: "read" })
  ) {
    fail("quality.yml: candidate checkout requires eligibility");
  }
  const steps = getSteps(quality);
  const checkoutIndex = steps.findIndex(
    (step) => isRecord(step) && step.uses?.startsWith("actions/checkout@"),
  );
  if (checkoutIndex < 0 || quality.needs !== "eligibility") {
    fail("quality.yml: candidate checkout requires eligibility");
  }
  const installIndex = indexOfRun(steps, "npm ci --ignore-scripts");
  const auditIndex = indexOfRun(steps, "npm audit --audit-level=moderate");
  const scriptIndices = requiredCommands.map((command) =>
    indexOfRun(steps, command),
  );
  if (
    installIndex < 0 ||
    auditIndex < installIndex ||
    scriptIndices.some((index) => index < 0 || index < auditIndex) ||
    scriptIndices.at(-1) !== steps.length - 1
  ) {
    fail(
      "quality.yml: immutable install and moderate audit precede repository scripts",
    );
  }
  if (!stepRuns(steps, "npm run ci:policy")) {
    fail("quality.yml: quality job runs the policy command");
  }
  if (
    !isRecord(aggregate) ||
    aggregate.name !== "Roastery required" ||
    aggregate.if !== "always()" ||
    !equal(aggregate.needs, ["eligibility", "quality"]) ||
    !equal(aggregate.permissions, { contents: "read" })
  ) {
    fail("quality.yml: aggregate contract");
  }
}

function validateSecretBoundary(workflow) {
  if (
    !hasExactKeys(workflow.on, ["pull_request_target", "workflow_dispatch"])
  ) {
    fail("secret-boundary.yml: approved triggers");
  }
  if (
    !equal(workflow.on?.pull_request_target?.types, [
      "opened",
      "synchronize",
      "reopened",
      "ready_for_review",
    ]) ||
    workflow.on?.workflow_dispatch !== null ||
    !equal(workflow.permissions, { contents: "read" }) ||
    !hasExactKeys(workflow.jobs, ["secret-boundary"])
  ) {
    fail("secret-boundary.yml: trusted boundary shape");
  }
  const boundary = workflow.jobs?.["secret-boundary"];
  if (
    !isRecord(boundary) ||
    boundary.name !== "Secret boundary" ||
    boundary["runs-on"] !== "ubuntu-latest" ||
    boundary.if !==
      "github.event_name == 'workflow_dispatch' || github.event.pull_request.author_association == 'OWNER' || github.event.pull_request.author_association == 'MEMBER'"
  ) {
    fail("secret-boundary.yml: trusted author boundary");
  }
  const steps = getSteps(boundary);
  const trusted = steps.findIndex((step) => step?.with?.path === "trusted");
  const candidate = steps.findIndex((step) => step?.with?.path === "candidate");
  if (
    trusted !== 0 ||
    candidate < 2 ||
    steps[candidate]?.uses !==
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1"
  ) {
    fail(
      "secret-boundary.yml: trusted checkout before candidate data checkout",
    );
  }
  const strings = collectStrings(workflow);
  if (
    strings.some(
      (value) =>
        /(?:^|\s)(?:npm|node)\s/u.test(value) || value.includes("secrets."),
    )
  ) {
    fail("secret-boundary.yml: candidate execution or secret context");
  }
  const scan = steps.at(-1)?.run;
  if (
    typeof scan !== "string" ||
    !scan.includes("set -o pipefail") ||
    !scan.includes("gitleaks git") ||
    !scan.includes("gitleaks dir") ||
    !scan.includes("git -C candidate fetch --no-tags --depth=1")
  ) {
    fail("secret-boundary.yml: complete history, worktree, and raw-blob scans");
  }
}

function validateReadOnlyPermissions(workflows) {
  for (const [name, workflow] of Object.entries(workflows)) {
    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      const allowsSecurityWrite =
        name === "codeql.yml" && jobName === "analyze";
      if (
        isRecord(job.permissions) &&
        Object.entries(job.permissions).some(
          ([scope, access]) =>
            access === "write" &&
            !(allowsSecurityWrite && scope === "security-events"),
        )
      ) {
        fail(`${name}: only CodeQL may write security events`);
      }
    }
  }
}

function validateDependabot() {
  const source = readFileSync(resolve(root, ".github/dependabot.yml"), "utf8");
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    fail("dependabot.yml: must parse uniquely");
    return;
  }
  const config = document.toJS({ maxAliasCount: -1 });
  const updates = config?.updates;
  if (!Array.isArray(updates) || updates.length !== 2) {
    fail("dependabot.yml: exact update lanes");
    return;
  }
  const npm = updates.find((update) => update?.["package-ecosystem"] === "npm");
  const actions = updates.find(
    (update) => update?.["package-ecosystem"] === "github-actions",
  );
  const minorPatch = ["minor", "patch"];
  const ignoredMajors = [
    { "dependency-name": "*", "update-types": ["version-update:semver-major"] },
  ];
  if (
    !isRecord(npm) ||
    !equal(npm.groups?.production, {
      "applies-to": "version-updates",
      "dependency-type": "production",
      "update-types": minorPatch,
    }) ||
    !equal(npm.groups?.development, {
      "applies-to": "version-updates",
      "dependency-type": "development",
      "update-types": minorPatch,
    }) ||
    !equal(npm.groups?.security, {
      "applies-to": "security-updates",
      patterns: ["*"],
    }) ||
    !equal(npm.ignore, ignoredMajors)
  ) {
    fail(
      "dependabot.yml: npm production, development, security, and major policy",
    );
  }
  if (
    !isRecord(actions) ||
    !equal(actions.groups?.versions, {
      "applies-to": "version-updates",
      "update-types": minorPatch,
      patterns: ["*"],
    }) ||
    !equal(actions.groups?.security, {
      "applies-to": "security-updates",
      patterns: ["*"],
    }) ||
    !equal(actions.ignore, ignoredMajors)
  ) {
    fail("dependabot.yml: GitHub Actions version, security, and major policy");
  }
}

function validateMergePolicy() {
  const policy = JSON.parse(
    readFileSync(resolve(root, ".github/merge-policy.json"), "utf8"),
  );
  if (
    policy.merge_method !== "squash" ||
    policy.auto_merge !== "github-native" ||
    policy.required_approvals !== 0 ||
    !equal(policy.eligible_author_associations, ["OWNER", "MEMBER"]) ||
    !equal(policy.required_events, ["pull_request", "merge_group"]) ||
    policy.review_policy?.required_approvals !== 0 ||
    policy.review_policy?.code_owner_reviews_required !== false
  ) {
    fail("merge policy is not zero-approval GitHub-native squash");
  }
  const contexts = policy.required_checks?.map(({ context }) => context) ?? [];
  for (const context of [
    "Roastery required",
    "Roastery dependency review",
    "Secret boundary",
    "Roastery CodeQL JavaScript-TypeScript",
  ]) {
    if (!contexts.includes(context))
      fail(`merge policy must require ${context}`);
  }
}

const discovered = readdirSync(workflowRoot)
  .filter((name) => name.endsWith(".yml"))
  .sort();
if (!equal(discovered, workflowNames)) fail("workflow set must be exact");

const workflows = {};
for (const name of workflowNames) {
  const document = parseDocument(
    readFileSync(resolve(workflowRoot, name), "utf8"),
    {
      uniqueKeys: true,
    },
  );
  if (document.errors.length > 0) {
    fail(`${name}: workflow must parse uniquely`);
    continue;
  }
  const workflow = document.toJS({ maxAliasCount: -1 });
  workflows[name] = workflow;
  requireWorkflowShape(name, workflow);
  validateActions(name, workflow);
  if (candidateWorkflows.has(name)) validateCandidateWorkflow(name, workflow);
}

if (workflows["codeql.yml"]) validateCodeql(workflows["codeql.yml"]);
if (workflows["policy.yml"]) validateDependencyReview(workflows["policy.yml"]);
if (workflows["quality.yml"]) validateQuality(workflows["quality.yml"]);
if (workflows["secret-boundary.yml"])
  validateSecretBoundary(workflows["secret-boundary.yml"]);
validateReadOnlyPermissions(workflows);

const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
if (
  packageJson.scripts?.["ci:policy"] !==
  "node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs"
) {
  fail("package command must run fixtures before the checker");
}
validateDependabot();
validateMergePolicy();

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("CI policy passed\n");
}
