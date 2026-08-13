# Contribution flow

Every substantive change uses a branch and pull request. One immutable target
wrapper delegates deterministic quality, dependency review, raw-blob secret
scanning, and CodeQL to the central trusted gate. GitHub then squash-merges
ordinary changes automatically; security policy, automation, executable
authority, contract, and published runtime paths wait for the protected
`coffee-security` Environment confirmation.

Contract changes and seed changes are deliberately separate. First publish and
freeze the contract commit and reproducible bundle digest. Only a later seed
pull request may add `roastery/roastery.json` that pins that exact tuple.

Contract, schema, parser, renderer, validator, workflow, security, and license
paths are protected by focused automated oracles. Ordinary future Bean
publication may not alter those paths. The standard flow has no compatibility
layer, alternate license mode, contract refresh, or direct default-branch write.
