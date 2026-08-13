# Roastery Security Lifecycle Implementation Plan

> **Execution:** Follow strict TDD and `AGENTS.md`. Keep contract, seed, and
> publication behavior unchanged; this plan changes repository governance only.

**Goal:** Make Roastery CI policy structurally enforceable and prepare the
repository for automatic merge with human review only on security-governance and
canonical contract boundaries.

**Architecture:** Read-only GitHub Actions remain the automated merge evidence.
A parsed YAML contract tests every workflow and rejects structural bypasses. The
live repository ruleset, enabled after the bootstrap PR merges, supplies a
human-only team review for sensitive paths outside candidate control.

**Stack:** Node.js 24, `yaml`, Node test runner, GitHub Actions, GitHub
Rulesets, Gitleaks, CodeQL, npm.

---

## Task 1: Structural workflow-policy fixtures

**Files:**

- Add: `tests/workflow-policy.test.mjs`
- Replace: `.github/ci-policy.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

Add exact `yaml@2.9.0` as a direct development dependency. Before replacing the
text/regex checker, prove it accepts representative bypasses: duplicate and
escaped YAML keys, flow-style/aliased unpinned actions, a future workflow with
write permissions, a job-level write override, an extra `pull_request_target`,
removal of the quality-owned policy step, and a weakened package command.

The replacement parses every workflow with unique-key enforcement, traverses all
mapping/sequence shapes, and checks the exact workflow set, triggers,
permissions, full-SHA action allowlist, checkout credential policy, member gate,
timeouts, dependency-review inputs, quality commands, trusted secret boundary,
merge-policy contexts, and package command. Only the CodeQL analyze job may
write `security-events`.

Set:

```json
"ci:policy": "node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs"
```

Fixture subprocesses invoke the checker directly against an isolated root so the
package command does not recurse.

**Checks:**

```bash
npm run ci:policy
node --test tests/workflow-policy.test.mjs
git diff --check
```

Commit: `test: enforce structural Roastery workflow policy`

## Task 2: Bound untrusted Roastery resource consumption

**Files:**

- Modify: `src/verified-read.ts`
- Modify: `src/roastery.ts`
- Modify: `src/contract-digest.ts`
- Modify: `src/content-license.ts`
- Modify: relevant acceptance tests
- Regenerate: `dist/**`

Encode the validated Codex Security scan's resource-exhaustion paths before
implementation. Add boundary-pass and one-unit-over-limit tests through the
exported API and CLI for:

- `roastery.json`, `index.json`, and `CONTENT_LICENSE.md` bytes;
- each Bean's bytes, origin count, Bean count, and aggregate Bean bytes;
- each fixed contract file and aggregate contract-bundle bytes;
- direct `parseContentLicense` input length and newline-dense input.

The common verified-read helper must reject an oversized descriptor from `fstat`
before `readFileSync`. Callers supply named conservative byte limits and
maintain explicit cardinality/aggregate budgets. Keep existing symlink,
non-regular-file, no-follow, containment, canonical UTF-8, and TOCTOU identity
checks. Preserve the public result shapes and fail-closed error states. Hash the
fixed contract bundle one bounded file at a time instead of retaining every
content buffer.

**Checks:**

```bash
npm run build
node --test tests/contract-acceptance.test.mjs tests/repository-acceptance.test.mjs tests/shell-smoke.test.mjs
npm run typecheck
git diff --check
```

Commit: `fix: bound Roastery validation resources`

## Task 3: Harden automated security and dependency gates

**Files:**

- Modify: `.github/workflows/codeql.yml`
- Modify: `.github/workflows/policy.yml`
- Modify: `.github/workflows/quality.yml`
- Modify: `.github/workflows/secret-boundary.yml`
- Modify: `.github/dependabot.yml`
- Modify: `.github/merge-policy.json`

Use the Task 1 contract as the failing specification, then:

- bound all jobs with timeouts;
- retain full-SHA action references, no persisted checkout credentials, and the
  `OWNER|MEMBER` gate before candidate checkout;
- use `npm ci --ignore-scripts` and run `npm audit --audit-level=moderate`
  before repository npm scripts;
- configure dependency review for moderate severity and
  `runtime,development,unknown`, show patched versions, never comment, and exact
  pull-request base/head SHAs;
- preserve trusted-base Gitleaks worktree/history/raw-blob coverage;
- add the Roastery CodeQL job to the declared required contexts;
- split production/development minor+patch Dependabot groups, keep security
  groups, and suppress routine semver-major version-update PRs.

**Checks:**

```bash
npm run ci:policy
npm run format:check
npm run typecheck
npm run build
npm run repository:check
npm run smoke
npm run package:check
npm audit --audit-level=moderate
actionlint .github/workflows/*.yml
git diff --check
```

Commit: `ci: harden Roastery security gates`

## Task 4: Encode the selective-review agent lifecycle

**Files:**

- Modify: `AGENTS.md`
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`
- Modify: `CODEOWNERS` comments only if needed

Replace the obsolete claim that human approval is never required. Agents must
open a pull request, report exact evidence, enable GitHub-native squash
auto-merge, and truthfully identify sensitive paths. The external ruleset—not
candidate code—decides whether the human-only team must approve. Do not add a
custom write-token merge controller.

**Checks:**

```bash
npm run ci:policy
npm run format:check
npm test
git diff --check
```

Commit: `docs: define selective-review Roastery lifecycle`

## Task 5: Verify security closure

From a clean install, run every repository command above plus the standard Codex
Security scan's focused post-change review. Prove a normal non-sensitive change
still needs zero approvals and that a `.github/**` or `contract/**` change
matches the future reviewer pattern. Request independent whole-branch review. Do
not claim the merge-boundary finding fixed until the live ruleset has the
human-only required reviewer and two reads confirm it.
