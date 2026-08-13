# Roastery Quality Map

| Objective                                         | Acceptance criteria and oracle                                                                                                                                                                        | Representative evidence                                            | Gate |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---- |
| Publish one immutable Standard Roastery contract  | Closed bundle files reproduce one length-framed SHA-256 digest; exact-byte changes alter it                                                                                                           | `contract-acceptance.test.mjs`                                     | PR   |
| Render one fixed Bean-rights declaration          | Valid owner attribution round-trips to exact bytes and digest; malformed and alternate licenses fail distinctly                                                                                       | `contract-acceptance.test.mjs`                                     | PR   |
| Keep repository data canonical and non-executable | The real public seed is exact and Bean-free; initialized owner shapes validate; stale index, unsafe paths, invalid Origins, and missing rights metadata fail closed                                   | `empty-seed-acceptance.test.mjs`, `repository-acceptance.test.mjs` | PR   |
| Ship the same authority through package and CLI   | Packed offline install includes contract files and required public API; every CLI command is read-only                                                                                                | `shell-smoke.test.mjs`, `package:check`                            | PR   |
| Keep publication governance lean                  | One pinned wrapper delegates quality, dependency review, raw-blob secret scanning, and CodeQL to the central gate; routine changes auto-merge while sensitive paths require the protected Environment | `ci:policy`, GitHub rules and checks                               | PR   |
| Bind publication CI to its GitHub repository      | Official state remains seed-valid; an owner fork is initialized; inherited or mismatched identity fails without mutating candidate bytes                                                              | `fork-publication-acceptance.test.mjs`, `repository:check`         | PR   |

Bean prose quality, Coffee usefulness, evaluator performance, benchmark
validity, contract refresh, and compatibility behavior are outside this
repository's implementation tests.

## Verification commands

```sh
npm run format:check
npm run typecheck
npm run dist:check
npm run repository:check
npm run smoke
npm run package:check
npm run ci:policy
git diff --check
```
