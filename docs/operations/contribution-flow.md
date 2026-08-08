# Repository contribution flow

Every change is developed on a branch and proposed through a pull request.
Commits must carry a GitHub-verifiable signature, and `main` accepts squash
merges only.

GitHub owns the merge decision:

- ordinary paths may use GitHub native auto-merge after all required checks,
  code scanning, and code quality rules pass;
- protected control-plane and contract paths additionally require the matching
  CODEOWNERS approval;
- repository workflows provide evidence but never merge pull requests.

This document is an ordinary-path canary. Its acceptance proves that a useful
documentation change can merge without human approval while retaining the same
signed-commit and CI gates as product changes.
