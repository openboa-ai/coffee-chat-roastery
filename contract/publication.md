# Standard Roastery Publication Contract

Every owner publication uses a branch, pull request, protected checks, and a
squash merge. Ordinary publication may change one Bean and the deterministic
index only. License, contract, validator, workflow, and security surfaces are
protected and require the owner's review of the exact head.

The publisher confirms this exact attestation for the proposed Bean bytes,
change-set digest, and head:

> I attest that this Bean contains no embedded third-party material requiring
> attribution or prior-modification notices beyond the current Standard Roastery
> declaration and citation contract; Origin URLs and the resources they identify
> are references outside this Bean license.

A failed technical check or rejected attestation prevents publication. A passing
receipt records only those checks and the explicit attestation; it does not
certify identity, ownership, truth, safety, legal sufficiency, quality, or
endorsement.

## Ordinary Bean publication evidence

The publication check executes against the exact pull-request base and head
commits from the GitHub event. The checked-out commit must equal that head and
the tracked worktree must be clean. An ordinary publication changes exactly one
`roastery/beans/<uuidv7>.md` file and `roastery/index.json`; any other changed
path is rejected.

Repository validation is authorized by a trusted contract repository, commit,
and digest supplied outside the candidate Roastery. The tuple must match the
Roastery manifest and the checked contract bundle. A repository cannot replace
both its local manifest and bundle to authorize itself.

The pull-request body contains exactly one closed machine-readable block:

```text
<!-- coffee-chat-publication
{"schema":"coffee-chat/bean-publication-attestation","head_sha":"<40-lowercase-hex>","bean_path":"roastery/beans/<uuidv7>.md","bean_digest":"sha256:<64-lowercase-hex>","change_set_digest":"sha256:<64-lowercase-hex>","attestation":"<exact attestation above>","accepted":true,"embedded_third_party_notices_required":false}
-->
```

`bean_digest` is SHA-256 over the exact Bean blob. For `change_set_digest`,
changed paths are sorted by their UTF-8 bytes. Each entry is framed as a
four-byte unsigned big-endian path length, path bytes, an eight-byte unsigned
big-endian content length, and exact head-commit blob bytes. SHA-256 is
calculated over the concatenated frames. The marker's head, Bean path, Bean
digest, and change-set digest must all match the inspected Git objects.

GitHub `merge_group` events do not carry the originating pull-request body.
Until an independently trusted attestation lookup is implemented, a merge group
containing a Bean publication fails explicitly as
`publication_attestation_unavailable`; it is never treated as accepted. A change
with no `roastery/**` path is reported as `not_applicable`.
