import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function trackedPaths() {
  return execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
  })
    .split("\u0000")
    .filter(Boolean)
    .filter((path) => existsSync(resolve(root, path)))
    .sort();
}

test("the fork seed contains only Roastery-owned product surfaces", () => {
  const paths = trackedPaths();
  const foreignPrefixes = [
    ".codex-plugin/",
    "benchmark/",
    "datasets/",
    "eval/",
    "metrics/",
    "plugin.json",
    "skills/",
    "tasks/",
    "verifiers/",
  ];

  for (const path of paths) {
    assert.equal(
      foreignPrefixes.some(
        (prefix) => path === prefix || path.startsWith(prefix),
      ),
      false,
      `foreign product surface: ${path}`,
    );
  }
});

test("the official seed contains no personal Bean or attribution declaration", () => {
  const paths = trackedPaths();

  assert.equal(
    paths.some((path) => path.startsWith("roastery/beans/")),
    false,
  );
  assert.equal(paths.includes("roastery/CONTENT_LICENSE.md"), false);
});
