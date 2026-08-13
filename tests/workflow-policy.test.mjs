import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

import { loadPolicyParser } from "../.github/policy-bootstrap.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const { parse } = loadPolicyParser(repositoryRoot);
const checker = join(repositoryRoot, ".github/ci-policy.mjs");

async function withFixture(mutate, check) {
  const fixture = await mkdtemp(join(tmpdir(), "roastery-workflow-policy-"));

  try {
    await cp(
      join(repositoryRoot, "package.json"),
      join(fixture, "package.json"),
    );
    await cp(
      join(repositoryRoot, "package-lock.json"),
      join(fixture, "package-lock.json"),
    );
    await cp(join(repositoryRoot, ".github"), join(fixture, ".github"), {
      recursive: true,
    });
    await mutate(fixture);
    await check(fixture);
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
}

async function replace(fixture, relativePath, from, to) {
  const target = join(fixture, relativePath);
  const source = await readFile(target, "utf8");
  assert.ok(source.includes(from), `fixture source must include ${from}`);
  await writeFile(target, source.replace(from, to));
}

async function runChecker(
  fixture,
  { candidateChecker = false, env = {} } = {},
) {
  try {
    const checkerPath = candidateChecker
      ? join(fixture, ".github/ci-policy.mjs")
      : checker;
    const result = await execFileAsync(process.execPath, [checkerPath], {
      env: { ...process.env, ...env, ROASTERY_CI_POLICY_ROOT: fixture },
    });
    return { output: `${result.stdout}${result.stderr}`, status: 0 };
  } catch (error) {
    const failure =
      /** @type {{code?: number, stderr?: string, stdout?: string}} */ (error);
    return {
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
      status: failure.code,
    };
  }
}

async function expectRejected(mutate, message) {
  await withFixture(mutate, async (fixture) => {
    const result = await runChecker(fixture);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, message);
  });
}

test("accepts the checked-in workflow policy", async () => {
  const result = await runChecker(repositoryRoot);
  assert.equal(result.status, 0, result.output);
});

test("authenticates the isolated parser lock before loading its code", async () => {
  await withFixture(
    async (fixture) => {
      const parserRoot = join(fixture, ".github/policy-parser");
      const lockPath = join(parserRoot, "package-lock.json");
      const lock = await readFile(lockPath, "utf8");
      await writeFile(
        lockPath,
        lock.replace(
          "sha512-2AvhNX3m",
          "sha512-candidateSelectedParserMustNeverExecuteBeforeAuthentication",
        ),
      );
      const packageRoot = join(parserRoot, "node_modules/yaml");
      await rm(packageRoot, { force: true, recursive: true });
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        join(packageRoot, "package.json"),
        `${JSON.stringify({ name: "yaml", version: "0.0.0", main: "index.cjs" })}\n`,
      );
      await writeFile(
        join(packageRoot, "index.cjs"),
        `require("node:fs").writeFileSync(process.env.ROASTERY_POLICY_MARKER, "executed\\n"); module.exports = { parseDocument() { throw new Error("candidate parser executed"); } };\n`,
      );
    },
    async (fixture) => {
      const marker = join(fixture, "candidate-parser-executed");
      const result = await runChecker(fixture, {
        candidateChecker: true,
        env: { ROASTERY_POLICY_MARKER: marker },
      });
      assert.equal(result.status, 1, result.output);
      assert.equal(
        existsSync(marker),
        false,
        "candidate-selected parser code executed before lock authentication",
      );
      assert.match(result.output, /authenticated before loading/u);
    },
  );
});

test("rejects a competing parser shrinkwrap before loading code", async () => {
  await expectRejected(
    (fixture) =>
      writeFile(
        join(fixture, ".github/policy-parser/npm-shrinkwrap.json"),
        `${JSON.stringify({ lockfileVersion: 3, packages: {} })}\n`,
      ),
    /npm-shrinkwrap\.json.*absent before loading/u,
  );
});

test("runs isolated structural policy before candidate dependencies and delegated scripts", async () => {
  const workflow = parse(
    await readFile(
      join(repositoryRoot, ".github/workflows/quality.yml"),
      "utf8",
    ),
  );
  const runs = workflow.jobs.quality.steps
    .map((step) => step.run)
    .filter((run) => typeof run === "string");
  const parserInstallIndex = runs.indexOf(
    "npm ci --ignore-scripts --prefix .github/policy-parser",
  );
  const parserAuthenticationIndex = runs.indexOf(
    "node .github/policy-bootstrap.mjs",
  );
  const parserAuditIndex = runs.indexOf(
    "npm audit --audit-level=moderate --prefix .github/policy-parser",
  );
  const installIndex = runs.indexOf("npm ci --ignore-scripts");
  const policyIndex = runs.indexOf("node .github/ci-policy.mjs");
  const delegatedIndex = runs.findIndex((run) => run.startsWith("npm run "));

  assert.equal(parserInstallIndex, parserAuthenticationIndex + 1);
  assert.equal(parserAuditIndex, parserInstallIndex + 1);
  assert.equal(policyIndex, parserAuditIndex + 1);
  assert.ok(policyIndex < installIndex);
  assert.ok(policyIndex < delegatedIndex);
  const checkerSource = await readFile(checker, "utf8");
  assert.doesNotMatch(checkerSource, /from ["']yaml["']/u);
  assert.match(checkerSource, /policy-bootstrap\.mjs/u);
});

test("standard local policy and smoke commands install the isolated parser", async () => {
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["policy:install"],
    "node .github/policy-bootstrap.mjs && npm ci --ignore-scripts --prefix .github/policy-parser",
  );
  assert.match(packageJson.scripts.smoke, /^npm run policy:install && /u);
  assert.match(
    packageJson.scripts["ci:policy"],
    /^npm run policy:install && /u,
  );
});

test("rejects a dependency lock redirected away from the npm registry", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        "package-lock.json",
        "https://registry.npmjs.org/prettier/-/prettier-3.9.6.tgz",
        "https://attacker.invalid/prettier-3.9.6.tgz",
      ),
    /package lock must preserve registry identity and integrity/u,
  );
});

test("rejects dependency aliases and an altered isolated parser integrity", async () => {
  await expectRejected(async (fixture) => {
    await replace(
      fixture,
      "package.json",
      '"prettier": "3.9.6"',
      '"prettier": "npm:attacker@1.0.0"',
    );
    await replace(
      fixture,
      ".github/policy-parser/package-lock.json",
      "sha512-2AvhNX3m",
      "sha512-0AvhNX3m",
    );
  }, /approved dependency contract|isolated policy parser/u);
});

test("rejects extra lifecycle hooks and changed publication metadata", async () => {
  await expectRejected(async (fixture) => {
    const target = join(fixture, "package.json");
    const packageJson = JSON.parse(await readFile(target, "utf8"));
    packageJson.scripts.install = "node attacker.mjs";
    packageJson.exports["."].import = "./dist/attacker.js";
    await writeFile(target, `${JSON.stringify(packageJson, null, 2)}\n`);
  }, /package execution and publication contract/u);
});

test("owner and member gates bind actor, author, and head repository", async () => {
  const quality = parse(
    await readFile(
      join(repositoryRoot, ".github/workflows/quality.yml"),
      "utf8",
    ),
  );
  const gate = quality.jobs.eligibility.steps[0].run;
  await assert.rejects(
    () =>
      execFileAsync("bash", ["-euo", "pipefail", "-c", gate], {
        env: {
          ...process.env,
          ACTOR: "different-maintainer",
          AUTHOR_ASSOCIATION: "OWNER",
          BASE_REPOSITORY: "openboa-ai/coffee-chat-roastery",
          EVENT_NAME: "pull_request",
          HEAD_REPOSITORY: "openboa-ai/coffee-chat-roastery",
          PR_AUTHOR: "pull-request-author",
        },
      }),
    /Command failed/u,
  );
});

test("rejects duplicate YAML mapping keys", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "name: Roastery quality\n",
        "name: Roastery quality\nname: Duplicate quality\n",
      ),
    /workflow must parse uniquely/u,
  );
});

test("rejects an escaped job-level permission override", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "  eligibility:\n    name: Roastery author eligibility\n    runs-on: ubuntu-24.04\n    timeout-minutes: 15\n    permissions:\n      contents: read",
        '  eligibility:\n    name: Roastery author eligibility\n    runs-on: ubuntu-24.04\n    timeout-minutes: 15\n    "permiss\\u0069ons":\n      contents: write',
      ),
    /job permissions/u,
  );
});

test("rejects a flow-style escaped unpinned action", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "    steps:\n      - name: Check out repository without persisted credentials",
        '    steps:\n      - { "u\\u0073es": actions/checkout@v7 }\n      - name: Check out repository without persisted credentials',
      ),
    /unapproved action/u,
  );
});

test("rejects an aliased unpinned action", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "    steps:\n      - name: Check out repository without persisted credentials",
        "    steps:\n      - &unpinned\n        uses: actions/checkout@v7\n      - *unpinned\n      - name: Check out repository without persisted credentials",
      ),
    /unapproved action/u,
  );
});

test("rejects a future workflow even when it is read-only", async () => {
  await expectRejected(
    (fixture) =>
      writeFile(
        join(fixture, ".github/workflows/future.yml"),
        "name: Future\non:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  future:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: 'true'\n",
      ),
    /workflow set/u,
  );
});

test("rejects a future workflow using the yaml extension", async () => {
  await expectRejected(
    (fixture) =>
      writeFile(
        join(fixture, ".github/workflows/unreviewed.yaml"),
        "name: Unreviewed\non:\n  pull_request:\npermissions:\n  contents: write\njobs:\n  unreviewed:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@v7\n",
      ),
    /workflow set/u,
  );
});

test("rejects an extra pull_request_target trigger", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "  pull_request:\n",
        "  pull_request:\n  pull_request_target: {}\n",
      ),
    /approved triggers/u,
  );
});

test("rejects a weakened candidate author gate", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "OWNER|MEMBER",
        "CONTRIBUTOR",
      ),
    /author eligibility job contract/u,
  );
});

test("rejects removing maintainer actor and author identity binding", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        '                  test "$ACTOR" = "$PR_AUTHOR"\n',
        "                  true\n",
      ),
    /author eligibility job contract/u,
  );
});

test("rejects removing trusted-boundary maintainer identity binding", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/secret-boundary.yml",
        "      == github.event.pull_request.user.login &&\n",
        "      != github.event.pull_request.user.login &&\n",
      ),
    /trusted author boundary/u,
  );
});

test("rejects removing the exact Dependabot identity", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        '              test "$PR_AUTHOR" = "dependabot[bot]"\n',
        "              exit 0\n",
      ),
    /author eligibility job contract/u,
  );
});

test("rejects disabling the author eligibility job", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "    name: Roastery author eligibility\n",
        "    name: Roastery author eligibility\n    if: ${{ false }}\n",
      ),
    /author eligibility job contract/u,
  );
});

for (const [name, field] of [
  ["conditional", "        if: ${{ false }}\n"],
  ["failure-tolerant", "        continue-on-error: true\n"],
]) {
  test(`rejects a ${name} author eligibility step`, async () => {
    await expectRejected(
      (fixture) =>
        replace(
          fixture,
          ".github/workflows/quality.yml",
          "      - name: Decide author eligibility\n",
          `      - name: Decide author eligibility\n${field}`,
        ),
      /author eligibility job contract/u,
    );
  });
}

test("checked-in author gates admit Dependabot without broadening contributors", async () => {
  const quality = await readFile(
    join(repositoryRoot, ".github/workflows/quality.yml"),
    "utf8",
  );
  const boundary = await readFile(
    join(repositoryRoot, ".github/workflows/secret-boundary.yml"),
    "utf8",
  );
  assert.match(quality, /dependabot\[bot\]/u);
  assert.match(boundary, /dependabot\[bot\]/u);
  assert.match(quality, /github\.actor/u);
  assert.match(quality, /head\.repo\.full_name/u);
  assert.match(boundary, /github\.actor/u);
  assert.match(boundary, /head\.repo\.full_name/u);
  assert.doesNotMatch(quality, /COLLABORATOR|CONTRIBUTOR/u);
});

test("rejects a missing bounded job timeout", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "    timeout-minutes: 15\n",
        "",
      ),
    /timeout-minutes/u,
  );
});

test("rejects a weakened dependency-review threshold", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/policy.yml",
        "          fail-on-severity: moderate\n",
        "",
      ),
    /dependency-review inputs/u,
  );
});

test("rejects re-enabling a merge-group workflow", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/policy.yml",
        "  pull_request:\n",
        "  pull_request:\n  merge_group:\n",
      ),
    /approved triggers/u,
  );
});

test("rejects a changed required-check integration identity", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/merge-policy.json",
        '"integration_id": 15368',
        '"integration_id": 1',
      ),
    /exact required checks/u,
  );
});

test("checked-in CI proves shipped dist is reproducible", async () => {
  const policy = JSON.parse(
    await readFile(join(repositoryRoot, ".github/merge-policy.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  const quality = await readFile(
    join(repositoryRoot, ".github/workflows/quality.yml"),
    "utf8",
  );
  assert.equal(
    packageJson.scripts["dist:check"],
    "npm run build && git diff --exit-code -- dist",
  );
  assert.match(quality, /npm run dist:check/u);
  assert.ok(policy.protected_paths.includes("/roastery/roastery.json"));
  assert.ok(policy.protected_paths.includes("/scripts/**"));
  assert.ok(policy.protected_paths.includes("/src/**"));
  assert.ok(policy.protected_paths.includes("/dist/**"));
  assert.ok(policy.protected_paths.includes("/tsconfig.build.json"));
  assert.ok(policy.protected_paths.includes("/tsconfig.json"));
  assert.equal(policy.merge_queue, false);
});

test("rejects a candidate-controlled build or publish recipe", async () => {
  for (const [from, to] of [
    ['"build": "node scripts/build.mjs"', '"build": "true"'],
    ['"prepack": "npm run build"', '"prepack": "true"'],
  ]) {
    await expectRejected(
      (fixture) => replace(fixture, "package.json", from, to),
      /package build contract/u,
    );
  }
});

test("rejects a base-ref checkout in candidate quality", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "          fetch-depth: 0\n",
        "          fetch-depth: 0\n          ref: ${{ github.event.pull_request.base.sha }}\n",
      ),
    /exact fail-closed candidate quality steps/u,
  );
});

test("rejects a manufactured aggregate result", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        '          test "$ELIGIBILITY_RESULT" = success\n          test "$QUALITY_RESULT" = success\n',
        "          true\n",
      ),
    /aggregate contract/u,
  );
});

for (const [name, workflow, before, after] of [
  [
    "CodeQL write-capable job",
    ".github/workflows/codeql.yml",
    "      - name: Analyze with CodeQL\n",
    "      - run: echo unexpected\n      - name: Analyze with CodeQL\n",
  ],
  [
    "candidate quality job",
    ".github/workflows/quality.yml",
    "      - run: npm run ci:policy\n",
    "      - run: echo unexpected\n      - run: npm run ci:policy\n",
  ],
  [
    "trusted secret boundary",
    ".github/workflows/secret-boundary.yml",
    "    steps:\n",
    "    env:\n      LEAK: ${{ secrets.OPENAI_API_KEY }}\n    steps:\n",
  ],
]) {
  test(`rejects added executable behavior in the ${name}`, async () => {
    await expectRejected(
      (fixture) => replace(fixture, workflow, before, after),
      /exact|secret|CodeQL/u,
    );
  });
}

for (const [name, workflow, step] of [
  [
    "candidate quality",
    ".github/workflows/quality.yml",
    "      - name: Scan complete Git history\n",
  ],
  [
    "trusted boundary",
    ".github/workflows/secret-boundary.yml",
    "      - name: Scan candidate without executing it\n",
  ],
]) {
  test(`rejects a failure-tolerant ${name} secret scan`, async () => {
    await expectRejected(
      (fixture) =>
        replace(
          fixture,
          workflow,
          step,
          `${step}        continue-on-error: true\n`,
        ),
      /exact|secret|raw-blob/u,
    );
  });
}

test("rejects removal of the canonical contract from sensitive paths", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/merge-policy.json",
        '    "/contract/**",\n',
        "",
      ),
    /exact protected paths/u,
  );
});

for (const path of ["/src/**", "/dist/**", "/scripts/**"]) {
  test(`rejects removing published execution boundary ${path}`, async () => {
    await expectRejected(
      (fixture) =>
        replace(fixture, ".github/merge-policy.json", `    "${path}",\n`, ""),
      /exact protected paths/u,
    );
  });
}

test("rejects a Dependabot ignore that can suppress security updates", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/dependabot.yml",
        "    groups:\n",
        '    ignore:\n      - dependency-name: "*"\n        update-types: [version-update:semver-major]\n    groups:\n',
      ),
    /major policy|parse uniquely/u,
  );
});

test("rejects removal of the quality-owned policy step", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "      - run: npm run ci:policy\n",
        "",
      ),
    /exact fail-closed candidate quality steps/u,
  );
});

test("rejects removal of the direct pre-delegation policy gate", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "      - name: Enforce repository policy before candidate dependencies\n        run: node .github/ci-policy.mjs\n",
        "",
      ),
    /exact fail-closed candidate quality steps/u,
  );
});

test("rejects loading the isolated parser before lock authentication", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "      - name: Authenticate the isolated policy parser lock\n        run: node .github/policy-bootstrap.mjs\n",
        "",
      ),
    /exact fail-closed candidate quality steps/u,
  );
});

test("rejects removing the isolated parser dependency audit", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "      - run: npm audit --audit-level=moderate --prefix .github/policy-parser\n",
        "",
      ),
    /exact fail-closed candidate quality steps/u,
  );
});

test("rejects moving the policy step outside the quality job", async () => {
  await expectRejected(async (fixture) => {
    await replace(
      fixture,
      ".github/workflows/quality.yml",
      "      - run: npm run ci:policy\n",
      "",
    );
    await replace(
      fixture,
      ".github/workflows/quality.yml",
      "jobs:\n",
      "jobs:\n  auxiliary:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: npm run ci:policy\n\n",
    );
  }, /exact fail-closed candidate quality steps/u);
});

test("rejects weakening the package policy command", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        "package.json",
        "npm run policy:install && node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs",
        "node .github/ci-policy.mjs",
      ),
    /package command/u,
  );
});

test("documents GitHub-native selective-review auto-merge", async () => {
  const [agentContract, pullRequestTemplate] = await Promise.all([
    readFile(join(repositoryRoot, "AGENTS.md"), "utf8"),
    readFile(join(repositoryRoot, ".github/PULL_REQUEST_TEMPLATE.md"), "utf8"),
  ]);

  assert.match(agentContract, /pull request/u);
  assert.match(agentContract, /GitHub-native squash auto-merge/u);
  assert.match(agentContract, /organization\s+rules[\s\S]*human review/iu);
  assert.match(agentContract, /custom write-token merge automation/u);
  assert.doesNotMatch(
    agentContract,
    /Human approval is not a merge condition/u,
  );
  assert.match(pullRequestTemplate, /Sensitive path/u);
  assert.match(pullRequestTemplate, /GitHub-native squash auto-merge/u);
});
