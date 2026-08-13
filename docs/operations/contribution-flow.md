# Contribution flow

Every substantive change uses a branch and pull request. Required deterministic
quality, dependency review, trusted secret scanning, and CodeQL checks must pass
for the latest head. GitHub then squash-merges ordinary changes automatically;
only security policy, automation, executable authority, contract, and published
runtime paths wait for the `security-maintainers` team review required by the
repository ruleset.

Contract changes and seed changes are deliberately separate. First publish and
freeze the contract commit and reproducible bundle digest. Only a later seed
pull request may add `roastery/roastery.json` that pins that exact tuple.

Contract, schema, parser, renderer, validator, workflow, security, and license
paths are protected by focused automated oracles. Ordinary future Bean
publication may not alter those paths. The standard flow has no compatibility
layer, alternate license mode, contract refresh, or direct default-branch write.
