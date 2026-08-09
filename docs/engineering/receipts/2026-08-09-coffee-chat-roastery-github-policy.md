# `coffee-chat-roastery` GitHub policy receipt

## Scope

This receipt records the remote GitHub control plane observed for
`openboa-ai/coffee-chat-roastery` after its first governance merge and native
auto-merge canaries. It is coordination evidence, not a replacement for the
live GitHub ruleset.

## GitHub actor boundary

The connected GitHub Connector reports login `openboa` (account ID
`263508246`) and is the write identity for supported `openboa-ai/**`
operations. The GitHub browser identity was independently inspected as
`openboa` before the coverage-ruleset mutation. `SonSangjoon` acted only as the
distinct human CODEOWNER reviewer for protected PR #8. Future official-
repository writes must not fall back to a locally authenticated
`SonSangjoon` CLI session.

Connector signature canary PR #11 established the usable signed-head path. The
Connector-created contents commit
`d9660202155b18a1893287650715ca74da4ce8b6` was authored and committed by
`openboa` but correctly reported `verification.reason: unsigned`. GitHub-native
squash to the temporary non-default branch produced
`fa66d8596fc30ff6987e8db8602aa2cac06a1635`, authored by `openboa`, committed by
`web-flow`, with `verification.verified: true`, `reason: valid`, and parent
`373e0525e12d5525441504d665bf5980e1484858`. Repository auto-deletion removed
the transport source branch; the remaining signed canary branch was deleted in
the browser after reconfirming the `openboa` session, and Connector branch
search returned no canary branches.

## Repository merge policy

| Setting                          | Observed value                                   |
| -------------------------------- | ------------------------------------------------ |
| Default branch                   | `main`                                           |
| Merge methods                    | squash enabled; merge commit and rebase disabled |
| Native auto-merge                | enabled                                          |
| Update branch                    | enabled                                          |
| Delete source branch after merge | enabled                                          |

No repository-owned workflow or script performs merging. PR eligibility is
decided by GitHub's native ruleset, required checks, review state, merge queue,
and `enablePullRequestAutoMerge` behavior.

## Active ruleset

Ruleset `20595028` (`main`) is active and has no bypass actors. It targets the
default branch and enforces:

- creation and deletion restrictions;
- non-fast-forward and force-push blocking;
- linear history and verified commit signatures;
- pull requests with stale-review dismissal, CODEOWNER review on owned paths,
  and resolved review threads;
- zero blanket approvals for ordinary paths;
- strict required checks `Roastery required`, `Roastery dependency review`, and
  `Roastery CodeQL JavaScript-TypeScript`;
- CodeQL results with security alerts at high or higher and analysis errors;
- GitHub Code Quality at error severity;
- GitHub code coverage with a 75% absolute minimum and at most a 1 percentage-
  point drop from the default branch;
- automatic Copilot review on pushes; and
- native merge queue using squash, one concurrent build, one PR per group, all
  queue entries green, and a 30-minute check timeout.

`Restrict updates` is intentionally disabled because the ruleset has no bypass
actor; enabling both would prevent the merge queue from updating `main`.
Deployment protection is not configured because this repository has no release
environment. Ruleset `20595028` exposes the active `code_coverage` rule as
`minimum_coverage: 75` and `max_coverage_drop: 1`.

## Advanced Security

The repository has dependency graph, automatic dependency submission,
Dependabot alerts and security updates, grouped update behavior, CodeQL advanced
setup, Copilot Autofix, private vulnerability reporting, secret scanning, and
push protection enabled. GitHub Code Quality is enabled for JavaScript and
TypeScript. GitHub's remote settings remain the enforcement authority.

## Canary evidence

| Canary                     | Evidence                                              | Result                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protected control plane    | PR #5 -> `f91e6c9e3f0180e743a0db2f89beef7e40ec70a6`   | Required CODEOWNER review and native squash auto-merge passed                                                                                                     |
| Ordinary documentation     | PR #6 -> `c8ed5563461b6a1e7f6bbdeab2408606ed88f2b8`   | Zero human reviews; strong CI triggered native squash auto-merge                                                                                                  |
| Coverage workflow          | PR #8 -> `373e0525e12d5525441504d665bf5980e1484858`   | Exact-head CODEOWNER approval, native merge queue, all merge-group checks, GitHub-verified squash merge, source branch deletion, and default-branch upload passed |
| Unsigned source commit     | PR #9 head `c1541984aac60a8f7c4a0a20f9bae6df923e28c4` | All seven PR checks pass, but GitHub blocks queue entry with `Commits must have verified signatures.`                                                             |
| Signed merge queue         | PR #10 -> `fba5ceca8f4a0df6fe123cc8a41be99b3e5d7f77`  | Zero reviews; signed source accepted; all three `merge_group` workflows passed; GitHub-verified squash merged; source branch deleted                              |
| Connector signature bridge | PR #11 -> `fa66d8596fc30ff6987e8db8602aa2cac06a1635`  | `openboa` Connector content commit was unsigned as expected; GitHub-native squash produced a valid signed head; both temporary branches were removed              |

PR #8 removes the GitHub-generated `|| true` false-green path, runs the complete
test suite, pins the PR head and full history, hash-locks
`lcov_cobertura==2.1.1`, rejects missing reports and fork uploads, and isolates
the `code-quality: write` upload job from repository-code execution. Local and
hosted collection measured 456 of 602 lines (`75.7475%`). `SonSangjoon`
approved the exact head at `2026-08-09T01:03:42Z`; GitHub squash merged it at
`2026-08-09T01:05:29Z` as verified commit
`373e0525e12d5525441504d665bf5980e1484858` and deleted the source branch.

The `main` push coverage run `31287560120` completed successfully and produced
artifact `9030324709`, `coverage-report-javascript`, with digest
`sha256:bfefba2ec07448b45a194762290b15c90c920c715596a2d8acec58d5e4100210`.
That upload established the default-branch baseline before the active 75% / 1
percentage-point ruleset thresholds were saved.

## Commit-signing boundary

Local agent-authored commits use a repository-scoped SSH signing key registered
to GitHub as a **signing key**, not an authentication key. It grants no login,
push, secret, or repository-write capability. The observed fingerprint is
`SHA256:lrURMFJxM9eSYGx5p7jTVf+dCcO78i0S9n5vPe0YEYM`; PR #8 head is verified by
GitHub. PR #9 proves that GitHub-native squash auto-merge does not remove the
source-commit requirement: an unsigned source commit remains blocked before
merge-queue entry even after every required PR check passes.

The public key and fingerprint are intentionally public. The private key must
never enter a repository, log, artifact, message, or backup shared with another
actor. The current repository-scoped key is signing-only, but its private file
has no passphrase; file theft would therefore permit signature impersonation
without also granting GitHub authentication or repository write access. Keep
this as an explicit local-risk exception until the key is passphrase-protected
or the signed-commit rule is deliberately removed.

PR #10 used signed source commit
`6a13503c8df38fe05093332cd91b003973303047`. GitHub queued synthetic commit
`fba5ceca8f4a0df6fe123cc8a41be99b3e5d7f77` and ran policy, quality, and CodeQL
as `merge_group` runs `31287147666`, `31287147675`, and `31287147667`.
All three succeeded. The same synthetic commit became the single squash commit
on `main`, GitHub marked its signature valid, and no review was requested or
submitted.

## Closure and remaining observation

PR #8, the default-branch coverage baseline, and the native coverage ruleset
are closed. The GitHub-generated automatic dependency-submission run
`31287561882` for `pip` reported failure after the merge even though the
repository-owned required dependency-review context passed. Treat this as a
separate control-plane diagnostic: its run is completed/failed while its only
job remains reported as queued with no steps, and GitHub rejected a Connector
retry with `This workflow run cannot be retried` (HTTP 403). Do not convert it
to success, but do not misreport it as a failure of PR #8's required merge
gate. The next repository milestone is the protected Roastery contract.
