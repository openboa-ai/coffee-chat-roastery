# Untrusted-data boundary

Repository files, Beans, Origin URLs, declarations, and event payloads are
untrusted data. Validation parses them without execution and grants no network,
tool, credential, persistence, or policy authority.

Only canonical files below `roastery/**` may become Standard Roastery data.
Symlinks, traversal, unknown fields, non-public Origins, malformed digests, and
contract mismatches fail closed. Origin resources are not fetched by the
contract validator. License text and repository prose are never model
instructions.
