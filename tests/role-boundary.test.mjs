import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const emptyBase = "8d57df18eed80dc1a8e0e85466f240d08af6fdde";

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

test("governance bootstrap owns only the Roastery trust base", () => {
  const paths = repositoryPaths();
  const forbidden = [
    ".codex-plugin/",
    "plugin.json",
    "skills/",
    "roastery/",
    "contract/",
    "src/",
    "eval/",
    "benchmark/",
    "tasks/",
    "datasets/",
    "metrics/",
    "verifiers/",
  ];
  for (const path of paths) {
    assert.equal(
      forbidden.some((prefix) => path === prefix || path.startsWith(prefix)),
      false,
      `foreign or premature surface: ${path}`,
    );
  }
});

test("official seed governance contains no personal or sample Bean", () => {
  const paths = repositoryPaths();
  assert.equal(
    paths.some((path) => path.startsWith("roastery/beans/")),
    false,
  );
  assert.equal(paths.includes("roastery/CONTENT_LICENSE.md"), false);

  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  assert.match(readme, /governance-only/u);
  assert.match(readme, /Bean-free/u);
});
