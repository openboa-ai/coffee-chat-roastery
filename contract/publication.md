# Standard Roastery Publication Contract

Every owner publication uses a branch, pull request, required checks, and a
GitHub-native squash merge. Human approval is not a merge condition. Ordinary
publication changes exactly one Bean and the deterministic index; contract,
license, validator, workflow, and security surfaces remain protected by focused
automated checks.

The publisher explicitly accepts this attestation for the proposed Bean bytes,
change-set digest, and pull-request head:

> I attest that this Bean contains no embedded third-party material requiring
> attribution or prior-modification notices beyond the current Standard Roastery
> declaration and citation contract; Origin URLs and the resources they identify
> are references outside this Bean license.

A failed technical check or rejected attestation prevents publication. A passing
result records only the technical checks and explicit attestation; it does not
certify identity, ownership, truth, safety, legal sufficiency, quality, or
endorsement.

## Ordinary Bean publication evidence

The publication check inspects exact Git objects from the GitHub event. The
checked-out commit must equal the event head and the tracked worktree must be
clean. An ordinary publication changes exactly one `roastery/beans/<uuidv7>.md`
file and `roastery/index.json`; any other changed path is rejected.

Repository validation receives the supported contract repository, commit, and
digest from repository-owned CI variables. The tuple must match
`roastery/roastery.json` and the canonical manifest inventory, including the
schema, parser, renderer, projection, validator, shared-type, and digest
authority executed by the check.

The pull-request body contains exactly one closed machine-readable block:

```text
<!-- coffee-chat-publication
{"schema":"coffee-chat/bean-publication-attestation","head_sha":"<40-lowercase-hex>","bean_path":"roastery/beans/<uuidv7>.md","bean_digest":"sha256:<64-lowercase-hex>","change_set_digest":"sha256:<64-lowercase-hex>","attestation":"<exact attestation above>","accepted":true,"embedded_third_party_notices_required":false}
-->
```

`bean_digest` is SHA-256 over the exact Bean blob. For `change_set_digest`,
changed paths are sorted by UTF-8 bytes. Each entry is framed as a four-byte
unsigned big-endian path length, path bytes, an eight-byte unsigned big-endian
content length, and exact head-commit blob bytes. SHA-256 is calculated over the
concatenated frames. Every bound value must match the inspected Git object.

A pull-request check validates the attestation and exact proposed head. A
single-entry merge group revalidates the resulting repository bytes, contract
tuple, changed-path shape, and deterministic index; it cannot replace the
already-required pull-request attestation. A change with no `roastery/**` path
is explicitly `not_applicable`.
