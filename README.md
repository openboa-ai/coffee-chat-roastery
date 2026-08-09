# Coffee Chat Roastery

Coffee Chat Roastery is the public, forkable, Bean-free authority for the
Standard Roastery contract. This repository owns the closed schemas, fixed CC BY
4.0 Bean-content declaration, canonical validation and index projection, and the
publication boundary consumed by the Coffee Chat Plugin.

The official repository contains no personal Beans or owner attribution. A
later, separate seed commit adds one canonical data root:

```text
roastery/
├── roastery.json
├── index.json
└── beans/
```

An initialized personal fork additionally contains
`roastery/CONTENT_LICENSE.md`, rendered only from validated owner attribution
after explicit acceptance. `roastery/roastery.json` is the sole downstream
contract pin; this contract commit intentionally cannot pin itself.

## Commands

```sh
roastery validate --root <repository> --format json
roastery project-index --root <repository> [--check]
roastery contract-digest --root <repository> --format json
```

`validate` and `project-index --check` are read-only. `project-index` without
`--check` writes only the deterministic `roastery/index.json`. Every command
returns structured JSON and fails closed on invalid or unsafe state.

The package API exports the same canonical content-license renderer/parser,
contract digest, validator, and index projector used by the CLI. The bundle
digest algorithm is documented in [contract/README.md](contract/README.md).

## Rights boundary

Official code, schemas, contracts, policy, tests, and tooling use the root
[MIT License](LICENSE), Copyright (c) 2026 Openboa AI.

Personal `roastery/beans/**` content uses the fixed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) declaration created
with owner-provided attribution. Origin URLs and the resources they identify
remain outside that Bean-content license. The official Bean-free repository does
not install `roastery/CONTENT_LICENSE.md`.

See [SECURITY.md](SECURITY.md), the
[Publication Contract](contract/publication.md), and the
[quality map](docs/quality-map.md) for the enforced boundaries.
