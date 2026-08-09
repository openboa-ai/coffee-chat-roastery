# Roastery Quality Map

## Objective: Canonical protected Roastery contract

| Field                 | Entry                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Publish a deterministic, Bean-free contract bundle that validates canonical Bean, index, repository identity, and immutable contract-pin boundaries.                                    |
| Acceptance criteria   | Closed schemas reject unknown fields; Bean IDs and paths are lowercase UUIDv7; Origins are public HTTPS; index bytes and bundle digests are deterministic; tuple mismatch fails closed. |
| Failure modes         | Unknown metadata, invalid or duplicate IDs, private Origins, empty bodies, non-canonical index bytes, altered contract files, or an incomplete pin is accepted.                         |
| Oracle                | Parsed validation status, exact canonical bytes, exact SHA-256 values, and absence of any official Bean or attribution declaration.                                                     |
| Evidence tier         | Contract and behavior.                                                                                                                                                                  |
| Representative suites | `tests/contract.test.ts`, `tests/validator.test.ts`.                                                                                                                                    |
| Gate/cost             | Local and pull request; fast.                                                                                                                                                           |
| Owner                 | `openboa-ai/coffee-chat-roastery`.                                                                                                                                                      |

### Scope decision

The suites fix external bytes and validation outcomes, not private function
order or Bean prose quality. A new independent parser or serializer invariant
requires a narrow contract test only when the repository-level oracle cannot
localize its failure.

## Objective: Fixed Bean-content rights and publication boundary

| Field                 | Entry                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Keep one commit-scoped `CC-BY-4.0` declaration and exact publisher attestation enforceable without an alternate license mode.                                                                                  |
| Acceptance criteria   | The parser and renderer agree on exact bytes; unsafe YAML and placeholders are invalid; unsupported and malformed states remain distinct; publication and attribution correction require their exact bindings. |
| Failure modes         | A placeholder installs, scope or license changes, unrepresentable third-party notices pass, stale review authorizes a correction, or prior grants appear revoked.                                              |
| Oracle                | Structured parser/publication status, exact declaration bytes, and an exact-head owner-review boundary.                                                                                                        |
| Evidence tier         | Contract and acceptance.                                                                                                                                                                                       |
| Representative suites | `tests/content-license-contract.test.ts`, `tests/rights-semantics-contract.test.ts`, `tests/publication-acceptance.test.ts`.                                                                                   |
| Gate/cost             | Local and protected pull request; fast.                                                                                                                                                                        |
| Owner                 | `openboa-ai/coffee-chat-roastery`.                                                                                                                                                                             |

### Scope decision

Tests cover technical declarations and attestations only. They do not certify
identity, ownership, legal sufficiency, truth, safety, quality, or endorsement.

## Objective: Read-only validation and bounded index projection

| Field                 | Entry                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Expose only the three declared local CLI operations while preventing traversal, symlink escape, execution, network behavior, or unintended writes.        |
| Acceptance criteria   | Validation and digest commands are read-only; check mode is read-only; only unchecked index projection writes; every command returns a structured status. |
| Failure modes         | Repository data executes, a symlink escapes the root, an invalid command mutates bytes, or an index projection overwrites a linked target.                |
| Oracle                | Temporary-tree digest, structured CLI status, and exact outside-file bytes.                                                                               |
| Evidence tier         | Behavior and acceptance.                                                                                                                                  |
| Representative suites | `tests/security-boundary.test.ts`.                                                                                                                        |
| Gate/cost             | Local and pull request; fast.                                                                                                                             |
| Owner                 | `openboa-ai/coffee-chat-roastery`.                                                                                                                        |

### Scope decision

The suite uses real temporary files and processes. It performs no network or
provider operation and makes no host-isolation claim.

## Objective: Rights-preserving protected contract refresh

| Field                 | Entry                                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Permit a complete contract re-pin only when personal Roastery bytes and independently derived rights semantics remain exactly unchanged.                                                                                      |
| Acceptance criteria   | Independent digest-bound A/B artifacts validate with fresh parser/schema state; declaration and `roastery/**` bytes match; all eight semantic negatives reject; canonical evidence and an artifact-bound receipt are emitted. |
| Failure modes         | Commit, digest, bundle bytes, owner, head, review, changed path, projection bytes, or projection digest mismatch passes; fixture evidence is reported as product performance or legal proof.                                  |
| Oracle                | Real temporary Git trees, exact SHA-256 projections, schema-valid canonical evidence, bound evidence/artifact digests, and fail-closed negative statuses.                                                                     |
| Evidence tier         | Acceptance fixture plus protected CI.                                                                                                                                                                                         |
| Representative suites | `tests/contract-refresh-acceptance.test.ts`.                                                                                                                                                                                  |
| Gate/cost             | Protected pull request and merge queue; medium.                                                                                                                                                                               |
| Owner                 | `openboa-ai/coffee-chat-roastery`.                                                                                                                                                                                            |

### Scope decision

GitHub review state is the only fake boundary. The suite combines a synthetic
fixture result with a referenced real control-plane canary receipt. CI first
uploads canonical evidence, then binds that upload's ID, digest, and URL into a
separate final receipt. Neither local fixture output is a remote Task 5 run,
personal-fork operation, legal conclusion, or performance measurement.
