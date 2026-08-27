import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.env.CI_POLICY_ROOT ?? ".");
const TRUSTED_CONTROL_SHA = "f33da6bbcdfebd0693ff7673d750f369629e000e";
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
assert.equal(existsSync(resolve(root, ".npmrc")), false);
assert.equal(existsSync(resolve(root, "npm-shrinkwrap.json")), false);
assert.deepEqual(
  readdirSync(resolve(root, ".github/workflows")).sort(),
  ["trusted.yml"],
);
assert.equal(
  readFileSync(resolve(root, ".github/workflows/trusted.yml"), "utf8"),
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
    uses: openboa-ai/.github/.github/workflows/coffee-trusted-gate.yml@${TRUSTED_CONTROL_SHA}
    with:
      control_sha: ${TRUSTED_CONTROL_SHA}
`,
  "trusted wrapper must remain exact",
);
assert.deepEqual(readdirSync(root).sort(), [
  ".editorconfig",
  ".git",
  ".gitattributes",
  ".githooks",
  ".github",
  ".gitignore",
  "AGENTS.md",
  "CODEOWNERS",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "beans",
  "origins",
  "package-lock.json",
  "package.json",
]);

assert.deepEqual(readdirSync(resolve(root, ".github")).sort(), [
  "PULL_REQUEST_TEMPLATE.md",
  "ci-policy.mjs",
  "dependabot.yml",
  "merge-policy.json",
  "workflows",
]);
assert.deepEqual(readdirSync(resolve(root, ".githooks")).sort(), ["pre-commit"]);
assert.deepEqual(readJson("package.json"), {
  name: "@openboa-ai/coffee-chat-roastery",
  version: "0.0.0",
  private: true,
  type: "module",
  scripts: { verify: "node .github/ci-policy.mjs" },
});
assert.deepEqual(readJson("package-lock.json"), {
  name: "@openboa-ai/coffee-chat-roastery",
  version: "0.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": {
      name: "@openboa-ai/coffee-chat-roastery",
      version: "0.0.0",
    },
  },
});
assert.equal(
  readFileSync(resolve(root, ".github/dependabot.yml"), "utf8"),
  `version: 2

updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    commit-message:
      prefix: deps
    allow:
      - dependency-name: "*"
        update-types:
          - version-update:semver-minor
          - version-update:semver-patch
    groups:
      security:
        applies-to: security-updates
        patterns:
          - "*"
      production:
        applies-to: version-updates
        dependency-type: production
        update-types: [minor, patch]
      development:
        applies-to: version-updates
        dependency-type: development
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    commit-message:
      prefix: deps
    allow:
      - dependency-name: "*"
        update-types:
          - version-update:semver-minor
          - version-update:semver-patch
    groups:
      security:
        applies-to: security-updates
        patterns:
          - "*"
      versions:
        applies-to: version-updates
        update-types: [minor, patch]
        patterns:
          - "*"
`,
  "Dependabot policy must remain bounded to approved update lanes",
);
assert.equal(
  readFileSync(resolve(root, "CODEOWNERS"), "utf8"),
  `# Ownership routing; repository rules add team review only for sensitive paths.
/.github/** @openboa
/.githooks/** @openboa
/.gitleaksignore @openboa
/.gitleaks.toml @openboa
/AGENTS.md @openboa
/CODEOWNERS @openboa
/.npmrc @openboa-ai/security-maintainers
/LICENSE @openboa
/SECURITY.md @openboa
/package.json @openboa
/package-lock.json @openboa
/npm-shrinkwrap.json @openboa-ai/security-maintainers
/origins/** @openboa
/beans/** @openboa
`,
  "CODEOWNERS must preserve the roastery ownership routes",
);
assert.match(
  readFileSync(resolve(root, "SECURITY.md"), "utf8"),
  /security@openboa\.ai/u,
  "SECURITY.md must provide a private reporting channel",
);

assert.deepEqual(readJson(".github/merge-policy.json"), {
  repository_role: "roastery",
  merge_method: "squash",
  auto_merge: "github-native",
  merge_queue: false,
  required_events: ["pull_request"],
  eligible_author_associations: ["OWNER", "MEMBER"],
  eligible_bot_logins: ["dependabot[bot]"],
  review_policy: {
    required_approvals: 0,
    code_owner_reviews_required: false,
    sensitive_paths_use_protected_environment: true,
  },
  required_approvals: 0,
  required_checks: [
    {
      context: "OpenBoa Coffee trusted required / OpenBoa Coffee trusted required",
      integration_id: 15368,
    },
  ],
  sensitive_review: {
    enforcement: "github_environment",
    environment: "coffee-security",
    required_approvals: 1,
    prevent_self_review: false,
  },
  protected_paths: [
    "/.github/**",
    "/.githooks/**",
    "/.gitleaksignore",
    "/.gitleaks.toml",
    "/AGENTS.md",
    "/CODEOWNERS",
    "/LICENSE",
    "/SECURITY.md",
    "/package.json",
    "/package-lock.json",
    "/.npmrc",
    "/npm-shrinkwrap.json",
    "/origins/**",
    "/beans/**",
  ],
});

for (const name of ["origins", "beans"]) {
  const directory = resolve(root, name);
  assert.equal(existsSync(directory), true, name);
  assert.equal(lstatSync(directory).isSymbolicLink(), false, name);
  assert.equal(lstatSync(directory).isDirectory(), true, name);
  assert.deepEqual(readdirSync(directory).sort(), [".gitkeep"], name);
}

for (const forbidden of [
  "contract",
  "dist",
  "roastery",
  "src",
  "tests",
  "scripts",
]) {
  assert.equal(existsSync(resolve(root, forbidden)), false, forbidden);
}

console.log("Coffee Chat Roastery structure and policy passed.");
