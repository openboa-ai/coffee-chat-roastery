import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.env.CI_POLICY_ROOT ?? ".");
const TRUSTED_CONTROL_SHA = "d6d8b73b4c1da5f57daa46d32a9f253cd0ef6a4a";
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
assert.equal(existsSync(resolve(root, ".npmrc")), false);
assert.equal(existsSync(resolve(root, "npm-shrinkwrap.json")), false);
assert.deepEqual(
  readdirSync(resolve(root, ".github/workflows"))
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort(),
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
