# Canonical Roastery contract

This directory is the immutable, candidate-independent contract bundle for a
Standard Roastery. It contains the closed structural schemas, the intentionally
invalid content-license template, and the publication and untrusted-data
boundaries. The package API supplies the matching canonical parser, renderer,
validator, projection, and digest implementation.

The bundle digest covers every regular file below `contract/`. Files are sorted
by their UTF-8, forward-slash relative-path bytes. Each file contributes an
unsigned 64-bit big-endian path length, the path bytes, an unsigned 64-bit
big-endian content length, and the exact content bytes. Symlinks and non-regular
entries are rejected. The final identity is `sha256:<lowercase hex>`.

The official repository remains Bean-free and contains no installable personal
attribution. `templates/content-license.md` is documentation-only: its
placeholder is deliberately rejected by the canonical renderer and parser.
