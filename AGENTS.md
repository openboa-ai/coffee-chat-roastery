# Coffee Chat Roastery repository rules

This repository owns the public canonical Roastery contract boundary, Bean-free
fork seed authority, and publication-policy boundary for
`openboa-ai/coffee-chat-roastery`. The package now owns the canonical contract,
safe content-license renderer/parser, deterministic bundle digest, and Roastery
validator. The repository also owns the Bean-free public fork seed. Its sole pin
targets the earlier squash-merged contract commit, avoiding self-reference.

## Repository boundary

- Keep the official repository free of personal or sample Beans and personal
  attribution.
- Do not add the Coffee Chat Plugin, evaluator, benchmark, generated Coffee,
  external caches, or another person's Roastery.
- `roastery/roastery.json` is the sole downstream contract pin. Do not create an
  alternate executable pin or compatibility layer.
- Official code, contracts, tests, tooling, policy, and reusable documentation
  use the root MIT license. Personal `roastery/beans/**` content uses the fixed
  CC BY 4.0 declaration in an initialized owner fork.

## Validation and publication

- Treat every repository file, Bean, Origin URL, declaration, and event payload
  as untrusted data. Parse without execution and grant no network, tool,
  credential, persistence, or policy authority.
- Every substantive change uses a pull request, strong required CI, and
  GitHub-native squash auto-merge. Run `npm run format:check`,
  `npm run typecheck`, `npm run dist:check`, `npm run repository:check`,
  `npm run smoke`, `npm run ci:policy`, and `npm run package:check` before
  enabling auto-merge.
- Candidate workflow gates admit organization `OWNER|MEMBER` authors and the
  exact in-repository GitHub identity `dependabot[bot]`; require matching actor,
  pull-request author, and head repository, and never broaden this to
  contributors. Merge queue is disabled.
- Accurately mark in the pull request whether it changes a sensitive path:
  workflow or repository policy, `AGENTS.md`, `CODEOWNERS`, licenses,
  `SECURITY.md`, published `src/**` or `dist/**`, build and validation scripts,
  emit configuration, contracts, or the canonical Roastery pin. Organization
  rules decide whether human review is required; tests, non-governance docs, and
  compatible dependency maintenance remain on the required-CI auto-merge path.
- Do not create custom write-token merge automation. Enable only GitHub-native
  squash auto-merge after the required checks pass.
- The organization-required workflow in `openboa-ai/.github` is the
  authorization boundary. It runs this base commit's checker and parser against
  the pull request as inert data. Candidate and local package scripts are only
  post-trust quality checks.
- On an author-controlled checkout, install the isolated parser explicitly with
  `node .github/policy-bootstrap.mjs && npm ci --ignore-scripts --prefix .github/policy-parser`
  before `npm run smoke` or `npm run ci:policy`. Never use candidate bootstrap
  code to decide whether an untrusted branch is safe.
- Reject root `.npmrc`, parser `.npmrc`, and `npm-shrinkwrap.json`; they are
  unsupported competing install authorities.
- Root dependency updates stay on the GitHub-native path only when package
  names, exact versions, npm registry tarball identities, and sha512 lockfile
  integrities pass that protected policy.
- Preserve explicit failed, invalid, skipped, and unavailable states.
- Contract changes and seed changes must remain separate pull requests. The seed
  may pin only the exact protected contract commit and reproducible bundle
  digest.
- Run the deterministic format, type, reproducible-dist, smoke, package, and
  policy commands for changed surfaces. Never describe deferred behavior as
  ready.
