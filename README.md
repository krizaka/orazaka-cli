<!-- krizaka-header -->
<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/krizaka/.github/main/profile/assets/orazaka-dark.svg">
  <img src="https://raw.githubusercontent.com/krizaka/.github/main/profile/assets/orazaka-light.svg" alt="Orazaka" width="96">
</picture>

# Orazaka CLI

**The AI that never leaves home.**

The `orazaka` developer CLI: install, start, dev, test, docs and pack tooling for the Orazaka workspace, with an offline SQLite queue.

[![CI](https://github.com/krizaka/orazaka-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/krizaka/orazaka-cli/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/krizaka/orazaka-cli/badge)](https://scorecard.dev/viewer/?uri=github.com/krizaka/orazaka-cli)
[![npm](https://img.shields.io/npm/v/@krizaka/orazaka-cli?label=%40krizaka%2Forazaka-cli&color=f67e23)](https://www.npmjs.com/package/@krizaka/orazaka-cli)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Orazaka](https://img.shields.io/badge/part%20of-Orazaka-f67e23)](https://github.com/krizaka/orazaka#repositories)
[![Docs](https://img.shields.io/badge/docs-krizaka.com-f67e23)](https://www.krizaka.com/en/products/orazaka)

[Documentation](https://www.krizaka.com/en/products/orazaka) · [Website](https://www.krizaka.com) · [Krizaka on GitHub](https://github.com/krizaka)

</div>
<!-- /krizaka-header -->

**Layer:** Client application · **npm:** [`@krizaka/orazaka-cli`](https://www.npmjs.com/package/@krizaka/orazaka-cli) (alias [`orazaka`](https://www.npmjs.com/package/orazaka)) · **License:** Apache-2.0 ·
part of the [Orazaka platform](https://github.com/krizaka/orazaka) by [Krizaka](https://krizaka.com)

## Quick start

Requirements: git, JDK 21, Node.js 22+, Docker (Python 3.11+ for the media worker).

```bash
npx orazaka install   # no workspace here? clones the platform into ./orazaka, then configures it
cd orazaka && ./mvnw install && (cd orazaka-apps/ui && npm install)
npx orazaka start     # Docker infrastructure (PostgreSQL + pgvector, Redis, RabbitMQ)
npx orazaka dev       # the whole stack: services, web (with the operator console), mobile
```

`orazaka` on npm is the short name of the canonical package **`@krizaka/orazaka-cli`** — both run the same CLI:

```bash
npx @krizaka/orazaka-cli install      # the same as npx orazaka install
npm install -g @krizaka/orazaka-cli   # then: orazaka <command>
```

`install` verifies the tools (and offers Homebrew installs on macOS), clones
[krizaka/orazaka](https://github.com/krizaka/orazaka) and every component repository when it is not run inside a
workspace (`--dir <path>`, `--depth <n>`; `--yes` accepts every default without a prompt), sets up the media worker's
Python environment and writes `.env` and `infra/docker-compose.override.yml`. `install --check-only` only reports.
`start`, `dev`, `test` and `docs` run inside a workspace and say how to get one when there is none.

## What it provides

The single orchestrator of the platform (no shell scripts): `orazaka install`, `start` (Docker infra),
`models pull`, `dev`, `onboard`, `test [unit|it|e2e]`, `docs [build|sync]`, `pack list|validate|install|publish`,
`demo seed`, `doctor`.

### Local image models

Images are generated on the Mac by [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) (`sd-server`,
Metal). `orazaka models image` installs the models it can serve — every one under a licence that allows commercial use:

| Model | Licence | Disk | RAM | Measured on an M1 Max (64 GB) |
|:---|:---|---:|---:|:---|
| `flux-2-klein-4b` — FLUX.2 [klein] 4B (default) | Apache-2.0 | 8.7 GB | ~11 GB | 1024×1024 in ~82 s, 1024×1280 in ~105 s |
| `z-image-turbo` — Z-Image Turbo | Apache-2.0 | 11.2 GB | ~12 GB | 1024×1024 in ~233 s |
| `v1-5-pruned-emaonly` — Stable Diffusion 1.5 | CreativeML OpenRAIL-M | 4.3 GB | ~5 GB | 512×512 in ~68 s |

```bash
orazaka models image list                    # licence, size, installed, which one is served
orazaka models image pull flux-2-klein-4b    # download into ~/models/stable-diffusion, sha256-verified
orazaka models image use flux-2-klein-4b     # make it the catalogue's default, then restart the stack
```

`sd-server` serves one model at a time: `orazaka start` launches the catalogue's default image model with its own
recipe (steps, guidance, flags from `src/services/image-model-recipes.json`) and refuses to serve another one under its name.
Prose inputs with commas go through a file: `orazaka studio run <installation> --inputs-file inputs.json`.

## Position in the platform

| | |
|:---|:---|
| Depends on | _none — this repository is a root of the dependency graph._ |
| Used by | _no other Orazaka repository._ |
| Workspace path | `orazaka-apps/ui/orazaka-cli` |

## Build

**Inside the Orazaka workspace** (npm workspaces link `@krizaka/*` packages from source):

```bash
git clone https://github.com/krizaka/orazaka.git && cd orazaka
node scripts/workspace.mjs clone
cd orazaka-apps/ui && npm install
npm run validate --workspace=orazaka-cli
```

**Standalone**: `npm install && npm run build && node dist/index.js --help`.

`npm run test:pack` packs `@krizaka/orazaka-cli` and its `orazaka` alias (`alias/`), installs them in an empty
project outside any workspace and runs the bin from there — what CI checks on every pull request. Releases:
[AGENTS.md](AGENTS.md#release).

## Governance

This repository follows the Orazaka governance contract — [AGENTS.md](https://github.com/krizaka/orazaka/blob/main/AGENTS.md)
in the workspace is normative; the local [AGENTS.md](AGENTS.md) only scopes it to this repository.

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

<sub>A Krizaka product · [krizaka.com](https://www.krizaka.com) · Apache-2.0</sub>
