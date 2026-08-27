import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.env.CI_POLICY_ROOT ?? ".");
assert.equal(existsSync(resolve(root, ".npmrc")), false);
assert.equal(existsSync(resolve(root, "npm-shrinkwrap.json")), false);
assert.deepEqual(
  readdirSync(resolve(root, ".github/workflows"))
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort(),
  ["trusted.yml"],
);

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
