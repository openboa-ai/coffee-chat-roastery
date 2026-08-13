import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPolicyParser } from "./policy-bootstrap.mjs";

const controlRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(process.env.ROASTERY_CI_POLICY_ROOT ?? controlRoot);
const { parseDocument } = loadPolicyParser(controlRoot);
const workflowRoot = resolve(root, ".github/workflows");
const failures = [];
if (existsSync(resolve(root, ".npmrc"))) {
  failures.push("root .npmrc must be absent");
}
if (existsSync(resolve(root, ".github/policy-parser/.npmrc"))) {
  failures.push("isolated policy parser .npmrc must be absent before install");
}
if (existsSync(resolve(root, "npm-shrinkwrap.json"))) {
  failures.push("root npm-shrinkwrap.json must be absent");
}
if (existsSync(resolve(root, ".github/policy-parser/npm-shrinkwrap.json"))) {
  failures.push(
    "isolated policy parser npm-shrinkwrap.json must be absent before loading",
  );
}
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
const candidateWorkflows = new Set(["policy.yml", "quality.yml"]);
const requiredCommands = [
  "npm run format:check",
  "npm run typecheck",
  "npm run dist:check",
  "npm run repository:check",
  "npm run smoke",
  "npm run package:check",
  "npm run ci:policy",
];
const authorEligibilityGate = `case "$EVENT_NAME" in
  pull_request)
    case "$AUTHOR_ASSOCIATION" in
      OWNER|MEMBER)
        test "$ACTOR" = "$PR_AUTHOR"
        test "$HEAD_REPOSITORY" = "$BASE_REPOSITORY"
        ;;
      *)
        test "$ACTOR" = "dependabot[bot]"
        test "$PR_AUTHOR" = "dependabot[bot]"
        test "$HEAD_REPOSITORY" = "$BASE_REPOSITORY"
        ;;
    esac
    ;;
  *) exit 1 ;;
esac
`;
const authorEligibilityEnv = {
  ACTOR: "${{ github.actor }}",
  AUTHOR_ASSOCIATION: "${{ github.event.pull_request.author_association }}",
  BASE_REPOSITORY: "${{ github.repository }}",
  EVENT_NAME: "${{ github.event_name }}",
  HEAD_REPOSITORY: "${{ github.event.pull_request.head.repo.full_name }}",
  PR_AUTHOR: "${{ github.event.pull_request.user.login }}",
};
const qualitySecretScan = [
  "test ! -e .gitleaks.toml",
  "test ! -e .gitleaksignore",
  'gitleaks git --config "$GITLEAKS_TRUSTED_CONFIG" \\',
  "  --gitleaks-ignore-path /dev/null --ignore-gitleaks-allow \\",
  "  --redact --no-banner .",
  'gitleaks dir --config "$GITLEAKS_TRUSTED_CONFIG" \\',
  "  --gitleaks-ignore-path /dev/null --ignore-gitleaks-allow \\",
  "  --redact --no-banner .",
  "",
].join("\n");
const boundarySecretScan = [
  "set -o pipefail",
  "test ! -e candidate/.gitleaks.toml",
  "test ! -e candidate/.gitleaksignore",
  "ignore_path=/dev/null",
  'gitleaks git --config "$GITLEAKS_TRUSTED_CONFIG" \\',
  '  --gitleaks-ignore-path "$ignore_path" --ignore-gitleaks-allow \\',
  '  --redact --no-banner "$GITHUB_WORKSPACE/candidate"',
  'gitleaks dir --config "$GITLEAKS_TRUSTED_CONFIG" \\',
  '  --gitleaks-ignore-path "$ignore_path" --ignore-gitleaks-allow \\',
  '  --redact --no-banner "$GITHUB_WORKSPACE/candidate"',
  'blob_dir="$(mktemp -d)"',
  'if test -n "$BASE_SHA"; then',
  "  git -C candidate fetch --no-tags --depth=1 \\",
  '    "https://github.com/$BASE_REPOSITORY.git" "$BASE_SHA"',
  '  object_range="$BASE_SHA..$HEAD_SHA"',
  "else",
  '  object_range="$HEAD_SHA"',
  "fi",
  'git -C candidate rev-list --objects "$object_range" |',
  "  cut -d' ' -f1 |",
  "  git -C candidate cat-file --batch-check='%(objectname) %(objecttype)' |",
  "  awk '$2 == \"blob\" { print $1 }' |",
  "  while read -r object_id; do",
  '    git -C candidate cat-file blob "$object_id" > "$blob_dir/$object_id"',
  "  done",
  'gitleaks dir --config "$GITLEAKS_TRUSTED_CONFIG" \\',
  '  --gitleaks-ignore-path "$ignore_path" --ignore-gitleaks-allow \\',
  '  --redact --no-banner "$blob_dir"',
  "",
].join("\n");

function fail(message) {
  failures.push(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

function packageNameFromLockPath(path) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  return index === -1 ? null : path.slice(index + marker.length);
}

function expectedRegistryUrl(name, version) {
  const tarballName = name.slice(name.lastIndexOf("/") + 1);
  return `https://registry.npmjs.org/${name}/-/${tarballName}-${version}.tgz`;
}

function validatePackageLock(packageJson, allowedDevDependencies) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  } catch (error) {
    fail(
      `package lock must parse: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }
  const rootPackage = lock?.packages?.[""];
  const devDependencies = packageJson.devDependencies ?? {};
  if (
    lock.lockfileVersion !== 3 ||
    lock.requires !== true ||
    lock.name !== packageJson.name ||
    lock.version !== packageJson.version ||
    !isRecord(lock.packages) ||
    !isRecord(rootPackage) ||
    rootPackage.name !== packageJson.name ||
    rootPackage.version !== packageJson.version ||
    !equal(rootPackage.devDependencies ?? {}, devDependencies) ||
    !equal(rootPackage.dependencies ?? {}, packageJson.dependencies ?? {}) ||
    !equal(
      Object.keys(devDependencies).sort(),
      [...allowedDevDependencies].sort(),
    ) ||
    !Object.values(devDependencies).every(
      (version) => typeof version === "string" && EXACT_VERSION.test(version),
    )
  ) {
    fail("package lock must match the approved dependency contract");
    return;
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === "") continue;
    const name = packageNameFromLockPath(path);
    if (
      name === null ||
      !isRecord(entry) ||
      typeof entry.version !== "string" ||
      !EXACT_VERSION.test(entry.version) ||
      entry.resolved !== expectedRegistryUrl(name, entry.version) ||
      typeof entry.integrity !== "string" ||
      !SHA512_INTEGRITY.test(entry.integrity) ||
      entry.link === true ||
      entry.hasInstallScript === true
    ) {
      fail("package lock must preserve registry identity and integrity");
      return;
    }
  }
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
  if (!hasExactKeys(workflow.on, ["pull_request"])) {
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
  const triggers = Object.keys(workflow.on ?? {}).sort();
  if (
    !equal(triggers, ["pull_request", "pull_request_target"]) &&
    !equal(triggers, ["pull_request_target"])
  ) {
    fail("codeql.yml: trusted-base triggers");
  }
  const analyze = workflow.jobs?.analyze;
  if (!hasExactKeys(workflow.jobs, ["analyze"])) fail("codeql.yml: exact jobs");
  if (
    !isRecord(analyze) ||
    !hasExactKeys(analyze, [
      "name",
      "if",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    analyze.name !== "Roastery CodeQL JavaScript-TypeScript" ||
    analyze.if !==
      "((github.event.pull_request.author_association == 'OWNER' || github.event.pull_request.author_association == 'MEMBER') && github.actor == github.event.pull_request.user.login && github.event.pull_request.head.repo.full_name == github.repository) || (github.actor == 'dependabot[bot]' && github.event.pull_request.user.login == 'dependabot[bot]' && github.event.pull_request.head.repo.full_name == github.repository)" ||
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
    !equal(steps, [
      {
        name: "Check out repository without persisted credentials",
        uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        with: {
          repository: "${{ github.event.pull_request.head.repo.full_name }}",
          ref: "${{ github.event.pull_request.head.sha }}",
          "persist-credentials": false,
        },
      },
      {
        name: "Initialize CodeQL",
        uses: "github/codeql-action/init@5595ccaf912efad79be6eef63a5619ff05969be3",
        with: { languages: "javascript-typescript", "build-mode": "none" },
      },
      {
        name: "Analyze with CodeQL",
        uses: "github/codeql-action/analyze@5595ccaf912efad79be6eef63a5619ff05969be3",
      },
    ])
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
    !hasExactKeys(review, [
      "name",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    review.name !== "Roastery dependency review" ||
    review["runs-on"] !== "ubuntu-24.04" ||
    !equal(review.permissions, { contents: "read" })
  ) {
    fail("policy.yml: dependency-review permissions");
  }
  if (
    !equal(getSteps(review), [
      {
        name: "Review pull request dependencies",
        uses: "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
        with: {
          "fail-on-severity": "moderate",
          "fail-on-scopes": "runtime,development,unknown",
          "show-patched-versions": true,
          "comment-summary-in-pr": "never",
        },
      },
    ])
  ) {
    fail("policy.yml: dependency-review inputs");
  }
}

function validateQuality(workflow) {
  const { eligibility, quality, aggregate } = workflow.jobs ?? {};
  if (!hasExactKeys(workflow.jobs, ["eligibility", "quality", "aggregate"])) {
    fail("quality.yml: exact jobs");
  }
  const eligibilitySteps = getSteps(eligibility);
  if (
    !isRecord(eligibility) ||
    !hasExactKeys(eligibility, [
      "name",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    eligibility.name !== "Roastery author eligibility" ||
    eligibility["runs-on"] !== "ubuntu-24.04" ||
    !equal(eligibility.permissions, { contents: "read" }) ||
    eligibilitySteps.length !== 1 ||
    !equal(eligibilitySteps[0], {
      name: "Decide author eligibility",
      env: authorEligibilityEnv,
      run: authorEligibilityGate,
    })
  ) {
    fail("quality.yml: author eligibility job contract");
  }
  if (
    !isRecord(quality) ||
    !hasExactKeys(quality, [
      "name",
      "needs",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    quality.name !== "Roastery deterministic quality" ||
    quality.needs !== "eligibility" ||
    !equal(quality.permissions, { contents: "read" })
  ) {
    fail("quality.yml: candidate checkout requires eligibility");
  }
  const steps = getSteps(quality);
  if (
    !equal(steps, [
      {
        name: "Check out repository without persisted credentials",
        uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        with: { "fetch-depth": 0, "persist-credentials": false },
      },
      {
        name: "Install immutable Gitleaks",
        run: ".github/scripts/install-gitleaks.sh",
      },
      { name: "Scan complete Git history", run: qualitySecretScan },
      {
        name: "Set up Node.js",
        uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
        with: { "node-version": 24, cache: "npm" },
      },
      {
        name: "Authenticate the isolated policy parser lock",
        run: "node .github/policy-bootstrap.mjs",
      },
      { run: "npm ci --ignore-scripts --prefix .github/policy-parser" },
      {
        run: "npm audit --audit-level=moderate --prefix .github/policy-parser",
      },
      {
        name: "Enforce repository policy before candidate dependencies",
        run: "node .github/ci-policy.mjs",
      },
      { run: "npm ci --ignore-scripts" },
      { run: "npm audit --audit-level=moderate" },
      ...requiredCommands.map((run) => ({ run })),
    ])
  ) {
    fail(
      "quality.yml: exact fail-closed candidate quality steps and secret scan",
    );
  }
  if (
    !isRecord(aggregate) ||
    !hasExactKeys(aggregate, [
      "name",
      "if",
      "needs",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    aggregate.name !== "Roastery required" ||
    aggregate.if !== "always()" ||
    !equal(aggregate.needs, ["eligibility", "quality"]) ||
    aggregate["runs-on"] !== "ubuntu-24.04" ||
    aggregate["timeout-minutes"] !== 15 ||
    !equal(aggregate.permissions, { contents: "read" }) ||
    !equal(getSteps(aggregate), [
      {
        name: "Require every applicable lane",
        env: {
          ELIGIBILITY_RESULT: "${{ needs.eligibility.result }}",
          QUALITY_RESULT: "${{ needs.quality.result }}",
        },
        run: 'test "$ELIGIBILITY_RESULT" = success\ntest "$QUALITY_RESULT" = success\n',
      },
    ])
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
    !hasExactKeys(boundary, [
      "name",
      "if",
      "runs-on",
      "timeout-minutes",
      "steps",
    ]) ||
    boundary.name !== "Secret boundary" ||
    boundary["runs-on"] !== "ubuntu-24.04" ||
    boundary["timeout-minutes"] !== 15 ||
    boundary.if !==
      "github.event_name == 'workflow_dispatch' || ((github.event.pull_request.author_association == 'OWNER' || github.event.pull_request.author_association == 'MEMBER') && github.actor == github.event.pull_request.user.login && github.event.pull_request.head.repo.full_name == github.repository) || (github.actor == 'dependabot[bot]' && github.event.pull_request.user.login == 'dependabot[bot]' && github.event.pull_request.head.repo.full_name == github.repository)"
  ) {
    fail("secret-boundary.yml: trusted author boundary");
  }
  const steps = getSteps(boundary);
  const strings = collectStrings(workflow);
  if (
    strings.some(
      (value) =>
        /(?:^|\s)(?:npm|node)\s/u.test(value) || value.includes("secrets."),
    )
  ) {
    fail("secret-boundary.yml: candidate execution or secret context");
  }
  if (
    !equal(steps, [
      {
        name: "Check out trusted security controls",
        uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        with: {
          ref: "${{ github.event.pull_request.base.sha || github.sha }}",
          "fetch-depth": 1,
          "persist-credentials": false,
          path: "trusted",
        },
      },
      {
        name: "Install immutable Gitleaks from trusted base",
        run: "trusted/.github/scripts/install-gitleaks.sh",
      },
      {
        name: "Check out candidate as data only",
        uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        with: {
          repository:
            "${{ github.event.pull_request.head.repo.full_name || github.repository }}",
          ref: "${{ github.event.pull_request.head.sha || github.sha }}",
          "fetch-depth": 0,
          "persist-credentials": false,
          path: "candidate",
        },
      },
      {
        name: "Scan candidate without executing it",
        env: {
          BASE_SHA: "${{ github.event.pull_request.base.sha || '' }}",
          BASE_REPOSITORY: "${{ github.repository }}",
          HEAD_SHA: "${{ github.event.pull_request.head.sha || github.sha }}",
        },
        run: boundarySecretScan,
      },
    ])
  ) {
    fail(
      "secret-boundary.yml: exact fail-closed history, worktree, and raw-blob scans",
    );
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
  const compatibleVersionUpdates = [
    {
      "dependency-name": "*",
      "update-types": [
        "version-update:semver-minor",
        "version-update:semver-patch",
      ],
    },
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
    !equal(npm.allow, compatibleVersionUpdates) ||
    Object.hasOwn(npm, "ignore")
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
    !equal(actions.allow, compatibleVersionUpdates) ||
    Object.hasOwn(actions, "ignore")
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
    policy.merge_queue !== false ||
    policy.required_approvals !== 0 ||
    !equal(policy.eligible_author_associations, ["OWNER", "MEMBER"]) ||
    !equal(policy.eligible_bot_logins, ["dependabot[bot]"]) ||
    !equal(policy.required_events, ["pull_request"]) ||
    policy.review_policy?.required_approvals !== 0 ||
    policy.review_policy?.code_owner_reviews_required !== false
  ) {
    fail("merge policy is not zero-approval GitHub-native squash");
  }
  if (
    !equal(policy.required_checks, [
      { context: "Roastery required", integration_id: 15368 },
      { context: "Roastery dependency review", integration_id: 15368 },
      { context: "Secret boundary", integration_id: 15368 },
      {
        context: "Roastery CodeQL JavaScript-TypeScript",
        integration_id: 15368,
      },
    ])
  ) {
    fail("merge policy must retain exact required checks");
  }
  if (
    !equal(policy.protected_paths, [
      "/.github/**",
      "/.githooks/**",
      "/.gitleaksignore",
      "/.gitleaks.toml",
      "/AGENTS.md",
      "/CODEOWNERS",
      "/LICENSE",
      "/SECURITY.md",
      "/.npmrc",
      "/npm-shrinkwrap.json",
      "/dist/**",
      "/scripts/**",
      "/src/**",
      "/tsconfig.build.json",
      "/tsconfig.json",
      "/contract/**",
      "/roastery/CONTENT_LICENSE.md",
      "/roastery/roastery.json",
    ])
  ) {
    fail("merge policy must retain exact protected paths");
  }
}

const discovered = readdirSync(workflowRoot)
  .filter((name) => /\.ya?ml$/u.test(name))
  .sort();
if (!equal(discovered, [...workflowNames, "trusted.yml"].sort()))
  fail("workflow set must contain legacy gates plus the trusted wrapper");

const trustedWorkflowSource = readFileSync(
  resolve(workflowRoot, "trusted.yml"),
  "utf8",
);
const trustedControlSha = trustedWorkflowSource.match(
  /uses: openboa-ai\/\.github\/\.github\/workflows\/coffee-trusted-gate\.yml@([0-9a-f]{40})/u,
)?.[1];
const expectedTrustedWorkflow =
  trustedControlSha &&
  `name: OpenBoa Coffee trusted gate

on:
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review]

permissions: {}

jobs:
  trusted:
    name: OpenBoa Coffee trusted required
    permissions:
      actions: read
      contents: read
      security-events: write
    uses: openboa-ai/.github/.github/workflows/coffee-trusted-gate.yml@${trustedControlSha}
    with:
      control_sha: ${trustedControlSha}
`;
if (!trustedControlSha || trustedWorkflowSource !== expectedTrustedWorkflow) {
  fail("trusted wrapper must remain exact");
}

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
const expectedPackageScripts = {
  build: "node scripts/build.mjs",
  "ci:policy":
    "node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs",
  "dist:check": "npm run build && git diff --exit-code -- dist",
  "format:check": "prettier --check .",
  "hooks:install": "git config core.hooksPath .githooks",
  "package:check": "node scripts/check-package.mjs",
  "security:scan": "scripts/security-scan.sh",
  "repository:check": "node scripts/check-repository-state.mjs --root .",
  smoke: "node --test tests/*.test.mjs",
  test: "npm run smoke",
  typecheck: "tsc --noEmit",
  prepack: "npm run build",
};
if (
  packageJson.scripts?.["ci:policy"] !==
  "node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs"
) {
  fail("package command must run fixtures before the checker");
}
if (
  !hasExactKeys(packageJson, [
    "name",
    "version",
    "private",
    "type",
    "repository",
    "files",
    "types",
    "exports",
    "bin",
    "engines",
    "scripts",
    "devDependencies",
  ]) ||
  packageJson.name !== "@openboa-ai/coffee-chat-roastery" ||
  packageJson.version !== "2026.8.10" ||
  packageJson.private !== true ||
  packageJson.type !== "module" ||
  packageJson.repository !==
    "https://github.com/openboa-ai/coffee-chat-roastery" ||
  !equal(packageJson.files, ["contract/", "dist/", "LICENSE", "README.md"]) ||
  packageJson.types !== "./dist/index.d.ts" ||
  !equal(packageJson.exports, {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  }) ||
  !equal(packageJson.bin, { roastery: "dist/cli.js" }) ||
  !equal(packageJson.engines, { node: ">=24" }) ||
  !equal(packageJson.scripts, expectedPackageScripts)
) {
  fail(
    "package execution and publication contract must preserve package build contract",
  );
}
validatePackageLock(packageJson, ["@types/node", "prettier", "typescript"]);
validateDependabot();
validateMergePolicy();

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("CI policy passed\n");
}
