# Coffee Chat Roastery

Coffee Chat Roastery is the public, forkable home of the canonical Roastery
contract, validator, and publication safeguards. It defines how one owner keeps
a public set of reviewed Beans without giving repository content executable or
policy authority.

The official repository is intentionally Bean-free and contains no personal
attribution. A personal fork has one canonical data root:

```text
roastery/
├── roastery.json
├── index.json
├── CONTENT_LICENSE.md
└── beans/
```

The current contract repository does not yet include that downstream seed
manifest. When the Bean-free seed is added, `roastery/roastery.json` will be the
only contract pin and will point to an already-published immutable contract
commit and bundle digest.

## Commands

```sh
roastery validate --root <path> --format json
roastery validate --root <path> --contract-commit <40-hex> --contract-digest <sha256> --format json
roastery project-index --root <path> [--check]
roastery contract-digest --root <repository> --format json
```

`validate` checks the selected repository against the independently trusted
bundle and source tuple carried by the installed Roastery package. A selected
fork cannot replace that authority with its own schema or validator. Structural
schemas are applied to the parsed manifest, index, Bean frontmatter, and content
declaration before semantic validation. The Plugin passes its pinned official
commit and bundle digest to an installed package. A source checkout may omit
those flags and use its own Git HEAD; validation fails closed when neither form
of immutable source authority is available.

`project-index` is the only command that writes, and only when `--check` is
omitted. `contract-digest` computes the deterministic SHA-256 digest of the
single inventory declared by [`contract/contract.json`](contract/contract.json).
That inventory covers the contracts, schemas, template, public API, CLI, parser,
renderer, projections, validators, shared types, and digest framing that the
Plugin vendors. The package executes compiled `dist/**` JavaScript rather than
raw TypeScript under `node_modules`. `npm run package:check` proves the same
runtime inventory is tracked and packaged, installs the real tarball with only
production dependencies, runs the npm bin, imports the public API, and checks
relative runtime-import closure.

The fixed [Init Contract](contract/init.md) defines the exact declaration
Preview, explicit acceptance, stale-Preview boundary, and zero-write outcomes.
Plugin UI and write orchestration remain owned by `openboa-ai/coffee-chat`.

## Rights boundary

Official code, schemas, contracts, policy, tests, and tooling use the root
[MIT License](LICENSE), Copyright (c) 2026 Openboa AI.

Personal `roastery/beans/**` content uses the fixed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) declaration created
with owner-provided attribution. Origin URLs and the resources they identify
remain outside that Bean-content license. The official Bean-free repository does
not install `roastery/CONTENT_LICENSE.md`.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
