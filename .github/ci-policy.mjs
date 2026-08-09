import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowRoot = resolve(root, ".github/workflows");
const failures = [];
const workflowNames = ["codeql.yml", "policy.yml", "quality.yml"];
const pinnedActions = [
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "github/codeql-action/analyze@5595ccaf912efad79be6eef63a5619ff05969be3",
  "github/codeql-action/init@5595ccaf912efad79be6eef63a5619ff05969be3",
];

function requireText(source, text, file) {
  if (!source.includes(text)) failures.push(`${file}: missing ${text}`);
}

const discovered = readdirSync(workflowRoot)
  .filter((name) => name.endsWith(".yml"))
  .sort();
if (JSON.stringify(discovered) !== JSON.stringify(workflowNames)) {
  failures.push("workflow set must be exactly quality, policy, and codeql");
}

for (const name of workflowNames) {
  const source = readFileSync(resolve(workflowRoot, name), "utf8");
  requireText(source, "pull_request:", name);
  requireText(source, "merge_group:", name);
  requireText(source, "permissions: {}", name);
  if (source.includes("pull_request_target") || source.includes("secrets.")) {
    failures.push(`${name}: unsafe event or secret context`);
  }
  for (const use of source.match(/uses:\s*([^\s]+)/gu) ?? []) {
    const action = use.replace(/^uses:\s*/u, "");
    if (!pinnedActions.includes(action)) {
      failures.push(`${name}: unapproved action ${action}`);
    }
  }
}

const quality = readFileSync(resolve(workflowRoot, "quality.yml"), "utf8");
for (const command of [
  "npm run format:check",
  "npm run typecheck",
  "npm run build",
  "npm run smoke",
  "npm run package:check",
  "npm run ci:policy",
]) {
  requireText(quality, command, "quality.yml");
}
requireText(quality, "OWNER|MEMBER", "quality.yml");
requireText(quality, "if: always()", "quality.yml");

const policy = JSON.parse(
  readFileSync(resolve(root, ".github/merge-policy.json"), "utf8"),
);
if (
  policy.merge_method !== "squash" ||
  policy.auto_merge !== "github-native" ||
  policy.required_approvals !== 0 ||
  JSON.stringify(policy.eligible_author_associations) !==
    JSON.stringify(["OWNER", "MEMBER"])
) {
  failures.push("merge policy is not zero-approval GitHub-native squash");
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("CI policy passed\n");
}
