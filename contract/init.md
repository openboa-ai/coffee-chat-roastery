# Standard Roastery Init Contract

Init is a Plugin-owned operation that consumes this fixed producer contract.
This repository defines the Preview and acceptance boundary; it does not
implement Plugin UI, GitHub orchestration, or write-side state transitions.

## Exact Preview before every write

Before any fork, branch, pull request, file, or Registry write, Init MUST show
one exact Preview containing:

- the public source repository
  `https://github.com/openboa-ai/coffee-chat-roastery`;
- the target owner, repository name `coffee-chat`, public visibility, and
  default branch;
- the affected local Registry state and the branch/pull-request process;
- the recovery boundary;
- the validated owner attribution;
- the exact rendered `roastery/CONTENT_LICENSE.md` bytes; and
- the SHA-256 digest of those exact declaration bytes.

The same Preview MUST state all seven fixed notice facts:

1. Standard Roastery Beans are public.
2. CC BY 4.0 permits sharing, commercial use, and adaptations, including
   AI-assisted or AI-generated adaptations.
3. Downstream users must provide attribution, link the license, and indicate
   changes without implying endorsement.
4. The grant is not revocable for recipients who already received it under the
   license.
5. The publisher may license only rights they own or control.
6. Origin URLs and the resources they identify are excluded.
7. An AI Coffee response is not the publisher's original wording or endorsement.

## Exact acceptance

Init MAY begin its first write only after the user explicitly accepts that exact
Preview, the rendered declaration and digest, the owner attribution, and the
rights-authority attestation. Acceptance is single-use and bound to the complete
Preview. Any changed Preview is stale and requires a new acceptance.

## Zero-write outcomes

Rejection, cancellation, invalid attribution, missing authority, or a stale
Preview MUST produce zero fork, branch, pull-request, file, and Registry writes.
No partial initialization, default acceptance, alternate license mode, or reused
acceptance is permitted.
