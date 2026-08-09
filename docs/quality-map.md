# Roastery Quality Map

| Objective                                         | Acceptance criteria and oracle                                                                                                           | Representative evidence                 | Gate |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---- |
| Publish one immutable Standard Roastery contract  | Closed bundle files reproduce one length-framed SHA-256 digest; exact-byte changes alter it                                              | `contract-acceptance.test.mjs`          | PR   |
| Render one fixed Bean-rights declaration          | Valid owner attribution round-trips to exact bytes and digest; malformed and alternate licenses fail distinctly                          | `contract-acceptance.test.mjs`          | PR   |
| Keep repository data canonical and non-executable | Bean-free seed and initialized owner shape validate; stale index, unsafe paths, invalid Origins, and missing rights metadata fail closed | `repository-acceptance.test.mjs`        | PR   |
| Ship the same authority through package and CLI   | Packed offline install includes contract files and required public API; CLI failures write nothing                                       | `shell-smoke.test.mjs`, `package:check` | PR   |
| Keep publication governance lean                  | Pull request, merge-group, dependency, CodeQL, zero-approval GitHub-native squash rules remain inspectable                               | `ci:policy`, GitHub checks              | PR   |

Bean prose quality, Coffee usefulness, evaluator performance, benchmark
validity, contract refresh, and compatibility behavior are outside this
repository's implementation tests.

## Verification commands

```sh
npm run format:check
npm run typecheck
npm run build
npm run smoke
npm run package:check
npm run ci:policy
git diff --check
```
