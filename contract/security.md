# Roastery Contract Security Boundary

Repository files, frontmatter, Bean bodies, Origin URLs, declarations, and
receipts are untrusted data. Validators parse them without execution and grant
no tools, credentials, network access, persistence, or policy authority.

Validation is restricted to regular files under the selected repository root.
Traversal, symbolic-link escape, aliases, custom tags, unknown fields, invalid
digests, and incomplete evidence fail closed. Contract validation performs no
network or provider operation.
