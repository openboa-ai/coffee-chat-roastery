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
function fail(message) {
  failures.push(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const TRUSTED_CONTROL_SHA = "d6d8b73b4c1da5f57daa46d32a9f253cd0ef6a4a";

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

const YAML_MAX_BYTES = 256 * 1024;
const YAML_MAX_ALIASES = 100;
const YAML_MAX_DEPTH = 32;
const YAML_MAX_NODES = 10_000;
const YAML_MAX_STRING_BYTES = 256 * 1024;

function assertYamlResourceBudget(value, label) {
  const pending = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  let stringBytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > YAML_MAX_NODES) {
      fail(`${label}: document node limit exceeded`);
      return false;
    }
    if (current.depth > YAML_MAX_DEPTH) {
      fail(`${label}: document depth limit exceeded`);
      return false;
    }
    if (typeof current.value === "string") {
      stringBytes += Buffer.byteLength(current.value, "utf8");
      if (stringBytes > YAML_MAX_STRING_BYTES) {
        fail(`${label}: document string limit exceeded`);
        return false;
      }
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    if (seen.has(current.value)) continue;
    seen.add(current.value);
    const children = Array.isArray(current.value)
      ? current.value
      : Object.entries(current.value).flat();
    for (const child of children) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function parseBoundedYaml(relativePath, label) {
  const source = readFileSync(resolve(root, relativePath), "utf8");
  if (Buffer.byteLength(source, "utf8") > YAML_MAX_BYTES) {
    fail(`${label}: document byte limit exceeded`);
    return undefined;
  }
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    fail(`${label}: must parse uniquely`);
    return undefined;
  }
  let value;
  try {
    value = document.toJS({ maxAliasCount: YAML_MAX_ALIASES });
  } catch {
    fail(`${label}: alias resource limit exceeded`);
    return undefined;
  }
  return assertYamlResourceBudget(value, label) ? value : undefined;
}

function validateDependabot() {
  const config = parseBoundedYaml(".github/dependabot.yml", "dependabot.yml");
  if (config === undefined) return;
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
    policy.review_policy?.code_owner_reviews_required !== false ||
    policy.review_policy?.sensitive_paths_use_protected_environment !== true
  ) {
    fail("merge policy is not zero-approval GitHub-native squash");
  }
  if (
    !equal(policy.required_checks, [
      {
        context:
          "OpenBoa Coffee trusted required / OpenBoa Coffee trusted required",
        integration_id: 15368,
      },
    ])
  ) {
    fail("merge policy must retain exact required checks");
  }
  if (
    !equal(policy.sensitive_review, {
      enforcement: "github_environment",
      environment: "coffee-security",
      required_approvals: 1,
      prevent_self_review: false,
    })
  ) {
    fail("merge policy must retain the protected Environment review");
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
      "/package.json",
      "/package-lock.json",
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
if (!equal(discovered, ["trusted.yml"])) {
  fail("target repository must expose only the trusted wrapper");
}

const trustedWorkflowSource = readFileSync(
  resolve(workflowRoot, "trusted.yml"),
  "utf8",
);
const trustedControlSha = trustedWorkflowSource.match(
  /uses: openboa-ai\/\.github\/\.github\/workflows\/coffee-trusted-gate\.yml@([0-9a-f]{40})/u,
)?.[1];
const expectedTrustedWorkflow = `name: OpenBoa Coffee trusted gate

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
`;
if (
  trustedControlSha !== TRUSTED_CONTROL_SHA ||
  trustedWorkflowSource !== expectedTrustedWorkflow
) {
  fail("trusted wrapper must remain exact");
}

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
