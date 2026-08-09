# Repository contribution flow

Develop each coherent change on a branch and propose it through a pull request.
`main` accepts GitHub-native squash merges only after the exact head passes the
required deterministic aggregate, dependency review, and native CodeQL rule.

Only organization `OWNER` or `MEMBER` pull-request authors are eligible.
CODEOWNERS routes sensitive changes to the owning team but does not create a
human approval requirement. The merge queue revalidates the same required
workflow graph with explicit failure states. Repository workflows provide
evidence and never merge pull requests themselves.
