# orazaka-cli — Governance scope (agent-neutral)

> This repository is one component of the **Orazaka platform**. The normative contract is
> [`AGENTS.md`](https://github.com/krizaka/orazaka/blob/main/AGENTS.md) at the root of the Orazaka workspace
> ([`krizaka/orazaka`](https://github.com/krizaka/orazaka)), together with its `.agent/rules/*`. When this repository
> is cloned inside the workspace (`orazaka-apps/ui/orazaka-cli`), that contract is loaded first and applies
> without exception. **No rule lives here** — this file only scopes it.

## Scope of this repository

- **Role:** The `orazaka` developer CLI: install, start, dev, test, docs and pack tooling for the Orazaka workspace, with an offline SQLite queue.
- **Layer:** Client application
- **Depends on:** nothing — never on another repository's Tier-3 implementation (AGENTS.md §2, [SEAM-002]).
- **Workspace path:** `orazaka-apps/ui/orazaka-cli`

## Definition of done

1. `npm run validate` (or `lint` + `build`) is green inside the workspace (`orazaka-apps/ui`).
2. No hard-coded colors, 250-line cap per component, types only from `@krizaka/orazaka-shared` (AGENTS.md §8).
