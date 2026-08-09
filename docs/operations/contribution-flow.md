# Repository contribution flow

Every change is developed on a branch and proposed through a pull request. Every
pull-request source commit must carry a GitHub-verifiable signature before the
pull request can enter the merge queue. `main` accepts squash merges only.

GitHub owns the merge decision:

- ordinary paths may use GitHub native auto-merge after all required checks,
  code scanning, and code quality rules pass;
- an eligible pull request enters the native merge queue, where the required
  `merge_group` checks run against GitHub's queued merge candidate;
- protected control-plane and contract paths additionally require the matching
  CODEOWNERS approval;
- repository workflows provide evidence but never merge pull requests.

This document is a signed ordinary-path merge-queue canary. Its acceptance
requires zero human reviews, successful pull-request and `merge_group` checks, a
GitHub-verified squash commit on `main`, and deletion of this source branch.
