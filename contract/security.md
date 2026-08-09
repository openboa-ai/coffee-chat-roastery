# Roastery Contract Security Boundary

Repository files, frontmatter, Bean bodies, Origin URLs, declarations, and
GitHub event data are untrusted. Validators parse them without execution and
grant no tools, credentials, network access, persistence, or policy authority.

Validation reads regular files only under the selected repository root.
Traversal, symbolic-link escape, unknown fields, unsafe frontmatter, invalid
URLs, duplicate Bean IDs, invalid digests, identity mismatch, and incomplete
evidence fail closed. Public validation derives schema and runtime authority
from the installed package's independently trusted canonical bundle and tuple;
the selected repository cannot authorize replacement bytes. Contract and
repository validation perform no network or provider operation. Only explicit
unchecked index projection may write, and it must never follow a linked target.
