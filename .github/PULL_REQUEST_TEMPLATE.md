## Scope

Describe the one observable change to the Origin/confirmed-Bean data home.

## Boundary check

- [ ] Only source Origins or explicitly confirmed Beans changed.
- [ ] No Roast candidate, prompt, Coffee, Bench case, Judge result, or Eval
      evidence was added here.
- [ ] No schema, index, embedding, crawler, or platform-specific layout was
      introduced without an admitted Bench/Eval requirement.
- [ ] Private source content, credentials, and personal data are not exposed.

## Verification

- [ ] `npm run verify`
- [ ] `git diff --check`
- [ ] The owner and confirmation status of every new Bean are explicit.

## Merge lifecycle

- [ ] Sensitive-path status is stated; organization rules decide whether the
      protected human review is required.
- [ ] GitHub-native squash auto-merge is enabled only after required checks
      pass.
