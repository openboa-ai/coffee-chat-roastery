# Roastery Quality Map

## Objective: Canonical Roastery contract and repository validation

| Field                 | Entry                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Publish one deterministic contract bundle and validate the canonical public Roastery shape.                                                                                                                                                                                                                             |
| Acceptance criteria   | One tracked/packageable inventory binds contract and runtime authority; its schemas gate parsed repository data before semantic validation; semantic validation enforces UUIDv7 paths, real public HTTPS URLs and valid ports, unique Bean IDs, normalized repository identity, exact index bytes, and tuple agreement. |
| Failure modes         | A selected repository supplies validation authority; a runtime import is omitted from the digest/package; schema-invalid data, duplicate IDs, port overflow, private Origins, unsafe paths, altered bundle files, non-canonical index bytes, or tuple mismatch is accepted.                                             |
| Oracle                | Structured validation status, exact deterministic bytes, and SHA-256 digests.                                                                                                                                                                                                                                           |
| Evidence tier         | Contract and behavior.                                                                                                                                                                                                                                                                                                  |
| Representative suites | `tests/contract.test.ts`, `tests/validator.test.ts`, `tests/security-boundary.test.ts`.                                                                                                                                                                                                                                 |
| Gate/cost             | Local and deterministic-quality pull-request lane; fast.                                                                                                                                                                                                                                                                |
| Owner                 | `openboa-ai/coffee-chat-roastery`.                                                                                                                                                                                                                                                                                      |

### Scope decision

Schemas own object and field structure. Canonical code owns cross-entry and
semantic invariants. The exact Init contract bytes are part of the same bundle,
while Plugin orchestration remains outside this repository. Tests fix external
bytes and outcomes, not private call order, implementation text, or Bean prose
quality.

Package acceptance uses a genuine tarball and production-only install. The npm
bin and public API must load compiled JavaScript, resolve every runtime
dependency, and reproduce the declared contract digest; source-only execution
does not substitute for that evidence.

## Objective: Fixed Bean-content rights and publication safeguards

| Field                 | Entry                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Enforce one commit-scoped `CC-BY-4.0` declaration and one-Bean exact-head publication without alternate license modes.                                                                                                                                           |
| Acceptance criteria   | Parser and renderer agree on exact bytes; placeholders and unsafe frontmatter are invalid; unsupported and malformed license states differ; publication binds exact Bean, change set, attestation, and PR head; merge-group validation rechecks canonical bytes. |
| Failure modes         | A placeholder installs, scope/license changes, stale or incomplete attestation, extra changed path, linked file, invalid repository, or unrepresentable third-party notice is accepted.                                                                          |
| Oracle                | Structured parser/publication status, exact declaration bytes, immutable Git blobs, trusted contract tuple, and repository validation result.                                                                                                                    |
| Evidence tier         | Contract and acceptance.                                                                                                                                                                                                                                         |
| Representative suites | `tests/content-license-contract.test.ts`, `tests/publication-acceptance.test.ts`.                                                                                                                                                                                |
| Gate/cost             | Local and publication pull-request lane; fast.                                                                                                                                                                                                                   |
| Owner                 | `openboa-ai/coffee-chat-roastery`.                                                                                                                                                                                                                               |

### Scope decision

The checks prove technical declaration, attestation, and artifact invariants.
They do not certify identity, ownership, legal sufficiency, truth, safety,
quality, or endorsement.

## Objective: Bounded local CLI and forbidden writes

| Field                 | Entry                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Expose only validation, deterministic index projection, and contract digest commands while preventing traversal, symlink escape, execution, network behavior, or unintended writes. |
| Acceptance criteria   | Validation, digest, and index check are read-only; only unchecked index projection writes; every command returns one JSON status.                                                   |
| Failure modes         | Repository data executes, a linked path escapes the root, an invalid/read-only command mutates bytes, or projection overwrites a linked target.                                     |
| Oracle                | Temporary-tree digest, process exit code, JSON output, and exact outside-file bytes.                                                                                                |
| Evidence tier         | Behavior and acceptance.                                                                                                                                                            |
| Representative suites | `tests/security-boundary.test.ts`.                                                                                                                                                  |
| Gate/cost             | Local and deterministic-quality pull-request lane; fast.                                                                                                                            |
| Owner                 | `openboa-ai/coffee-chat-roastery`.                                                                                                                                                  |

### Scope decision

The suite uses real temporary files and child processes without network or
provider access. It makes no host-isolation or product-performance claim.

## Objective: Lean fail-closed repository governance

| Field                 | Entry                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Permit GitHub-native squash auto-merge only after the necessary role-local quality, publication, dependency, and CodeQL evidence exists.                                                                                                                                                                                                                                                                |
| Acceptance criteria   | Candidate code runs only after an `OWNER`/`MEMBER` decision; collaborator, contributor, none, missing, and login-only inputs fail; merge groups use no pull-request field; quality collects meaningful TS/JS coverage and package closure without a third workflow; the aggregate depends only on eligibility, quality, and publication and preserves failed, invalid, skipped, and unavailable states. |
| Failure modes         | A non-member or login exception reaches candidate execution, an action is unpinned, permissions widen, coverage/package evidence disappears, a duplicate third lane appears, a necessary lane disappears, or a missing state becomes success.                                                                                                                                                           |
| Oracle                | Parsed workflow graph, executable CI policy result, merge-policy structure, permissions, commands, and action pins.                                                                                                                                                                                                                                                                                     |
| Evidence tier         | Contract and behavior.                                                                                                                                                                                                                                                                                                                                                                                  |
| Representative suites | `tests/governance-policy.test.mjs`, `.github/ci-policy.mjs`.                                                                                                                                                                                                                                                                                                                                            |
| Gate/cost             | Local and deterministic-quality pull-request lane; fast.                                                                                                                                                                                                                                                                                                                                                |
| Owner                 | `openboa-ai/coffee-chat-roastery`.                                                                                                                                                                                                                                                                                                                                                                      |

### Scope decision

The local oracle validates committed workflow intent and cannot simulate the
GitHub ruleset evaluator. Remote settings remain platform-owned evidence.
