# Repository contribution flow

Every change is developed on a branch and proposed through a pull request.
`main` accepts squash merges only, and every commit that reaches `main` must
carry a GitHub-verifiable signature.

Pull-request source commits are review and CI inputs; squash merge does not
retain them in `main` history. They do not need a local signing key when the
native merge queue creates a GitHub-signed squash commit. Direct pushes to
`main` remain prohibited.

GitHub owns the merge decision:

- ordinary paths may use GitHub native auto-merge after all required checks,
  code scanning, and code quality rules pass;
- protected control-plane and contract paths additionally require the matching
  CODEOWNERS approval;
- repository workflows provide evidence but never merge pull requests.

This document is an ordinary-path canary. Its initial acceptance proved that a
useful documentation change can merge without human approval. This update uses
an intentionally unsigned source commit; acceptance requires the native merge
queue to re-run required checks and place only its verified squash commit on
`main`.
