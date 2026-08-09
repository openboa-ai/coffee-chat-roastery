# Roastery Quality Map

## Migration shell available now

| Objective                                                        | Evidence                                                | Status            |
| ---------------------------------------------------------------- | ------------------------------------------------------- | ----------------- |
| Keep the official repository Bean-free and attribution-free      | Repository layout, README, and MIT license              | Available         |
| State the future fixed CC BY 4.0 boundary for owner Bean content | README and contract directory note                      | Available         |
| Ship only `validate`, `project-index`, and `contract-digest`     | Packed offline install and CLI smoke test               | Available, closed |
| Prevent shell writes and false readiness                         | Each command returns `not_implemented` with exit code 1 | Available         |
| Keep deterministic governance lean                               | Workflow/policy smoke test and CI policy script         | Available         |

## Implementation deferred

The canonical schema, Roastery seed, validation semantics, index projection,
contract digest, publication enforcement, compatibility, migration equality,
refresh logic, and detailed fixtures are not implemented by this repository.
They require a separately approved change with behavior-level tests.

## Verification commands

```sh
npm run format:check
npm run typecheck
npm run build
npm run smoke
npm run ci:policy
npm run package:check
git diff --check
```
