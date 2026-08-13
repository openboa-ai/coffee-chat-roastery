## Scope

Describe the migration-shell boundary or separately approved implementation.

## Deferred behavior

Confirm that validator, projection, digest, publication, compatibility, and
migration machinery are not claimed unless this pull request implements and
tests them.

## Verification

- [ ] `npm run format:check`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run repository:check`
- [ ] `npm run smoke`
- [ ] `npm run ci:policy`
- [ ] `npm run package:check`

## Merge lifecycle

- [ ] I marked the applicable sensitive-path status below.
  - [ ] No sensitive path changed.
  - [ ] Sensitive path changed: describe the path and review impact.
- [ ] GitHub-native squash auto-merge is enabled only after all required checks
      pass. Organization rules decide whether human review is required.
