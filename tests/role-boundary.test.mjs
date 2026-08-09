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

test("protected contract milestone stays inside the Roastery owner boundary", () => {
  const paths = repositoryPaths();
  const forbidden = [
    ".codex-plugin/",
    "plugin.json",
    "skills/",
    "roastery/",
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
    if (path.startsWith("src/")) {
      assert.equal(
        path === "src/cli.ts" ||
          path.startsWith("src/contract/") ||
          path.startsWith("src/projection/") ||
          path.startsWith("src/validation/"),
        true,
        `foreign Roastery implementation surface: ${path}`,
      );
    }
  }
});

test("official protected contract remains Bean-free and attribution-free", () => {
  const paths = repositoryPaths();
  assert.equal(
    paths.some((path) => path.startsWith("roastery/beans/")),
    false,
  );
  assert.equal(paths.includes("roastery/CONTENT_LICENSE.md"), false);

  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  assert.match(readme, /protected Roastery contract/u);
  assert.match(readme, /Bean-free/u);
  assert.doesNotMatch(readme, /governance-only/u);
});
