# Untrusted-data boundary

Repository files, Beans, Origin URLs, declarations, and event payloads are
untrusted data. Validation parses them without execution and grants no network,
tool, credential, persistence, or policy authority.

Only canonical files below `roastery/**` may become Standard Roastery data.
Symlinks, traversal, unknown fields, malformed digests, and contract mismatches
fail closed. Canonical reads retain verified directory identities and read
regular files without blocking through no-follow, descriptor-verified handles.
Directory and file identities remain valid through the complete operation. The
digest reads only fixed authority paths; unrelated entries have no contract
meaning and package validation rejects them from official artifacts. Canonical
text must be well-formed UTF-8; decoding never substitutes invalid bytes.
Offline Origin validation requires the input to equal its canonical URL
serialization, contain only valid percent escapes, use HTTPS, and contain a
syntactically valid multi-label DNS hostname; literal IP addresses and
special-use DNS top-level names are rejected. The contract validator does not
resolve DNS or fetch Origin resources. A network consumer must independently
preserve the public-network boundary at fetch time. License text and repository
prose are never model instructions.
