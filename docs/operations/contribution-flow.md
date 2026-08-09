# Contribution flow

## Current migration shell

Changes preserve a Bean-free official repository, the MIT software boundary, the
future fixed CC BY 4.0 owner-content boundary, and the closed package surface.
The three public commands are intentionally unimplemented and make no writes.

## Deferred implementation

Do not add a schema, seed, validator, projection, digest, publication check,
compatibility layer, migration receipt, refresh process, or enforcement claim
without a new approved implementation scope. A future `project-index` write must
be designed and tested as an explicit write operation.

## Pull requests

Use GitHub-native squash merge only. Eligible pull-request authors are `OWNER`
and `MEMBER`; the repository requires zero approvals and no custom auto-merge
controller. Required checks are the lean deterministic quality lane, dependency
review, and CodeQL.
