# Coffee Chat Roastery

Coffee Chat Roastery is the public, forkable, Bean-free authority for the future
canonical Roastery contract. This migration shell establishes the repository
boundary and package shape; it does not implement a validator, index projection,
publication enforcement, seed, or compatibility layer.

The official repository is intentionally Bean-free and contains no personal
attribution. A personal fork has one canonical data root:

```text
roastery/
├── roastery.json
├── index.json
├── CONTENT_LICENSE.md
└── beans/
```

When the seed is implemented, `roastery/roastery.json` will be the sole
downstream contract pin. It is not present in this official repository today.

## Commands

```sh
roastery validate
roastery project-index
roastery contract-digest
```

All three commands are discoverable but return `{"status":"not_implemented"}`
with a non-zero exit code. They make no writes. The future `project-index`
capability is the only contemplated write surface, and needs a separately
approved implementation.

The installed package exports exactly `validate`, `projectIndex`, and
`contractDigest`; each currently returns the same explicit deferred status.
`npm run package:check` packs, installs, and runs this closed surface offline.

## Rights boundary

Official code, schemas, contracts, policy, tests, and tooling use the root
[MIT License](LICENSE), Copyright (c) 2026 Openboa AI.

Personal `roastery/beans/**` content uses the fixed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) declaration created
with owner-provided attribution. Origin URLs and the resources they identify
remain outside that Bean-content license. The official Bean-free repository does
not install `roastery/CONTENT_LICENSE.md`.

See [SECURITY.md](SECURITY.md) and [the quality map](docs/quality-map.md) for
the current shell boundary and deferred implementation work.
